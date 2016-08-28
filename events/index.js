'use strict';

var moment = require('moment-timezone');
var overlap = require('word-overlap');
var clc = require('cli-color');
var eventsResult = {
  'meta': {},
  'events': []
};
var eventsToday = {
  'meta': {},
  'events': []
};
var eventsHour = {
  'meta': {},
  'events': []
}
var logger = require('tracer').colorConsole({
  format: '{{timestamp}} <{{title}}> ({{path}}:{{line}}:{{pos}}:{{method}}) {{message}}',
  dateformat: 'mmm dd HH:MM:ss',
  preprocess:  function(data) {
    data.path = data.path.replace(process.cwd(), '');
  }
});

module.exports = function(config) {
  var whitelistEvents = config.whitelistEvents;
  var blacklistEvents = config.blacklistEvents;

  var API = {
    getFacebookEvents: require('./facebookEvents')(config).get,
    getMeetupEvents: require('./meetupEvents')(config).get,
    getEventbriteEvents: require('./eventbriteEvents')(config).get,
    getIcsEvents: require('./icsEvents')(config).get
  };

  function isDuplicateEvent(event1, event2) {

    if (event1.formatted_time !== event2.formatted_time){
      return false;
    }

    if (event1.name === event2.name) {
      // console.log(clc.magenta('Info: Duplicate event added: ' + event2.url));
      // console.log(clc.magenta('Info: Duplicate event overlaps: ' + overlappedEventDescription));
      // console.log(clc.magenta('-----------'))
      return true;
    }

    var options = {
      ignoreCase: true,
      ignoreCommonWords: true,
      ignoreNumber: true,
      common: config.ignoreWordsInDuplicateEvents.concat(config.city.toLowerCase()),
      depluralize: true
    };

    var overlappedEventName = overlap(event1.name, event2.name, options);
    var overlappedEventLocation = overlap(event1.location, event2.location, options);
    var overlappedEventDescription = overlap(event1.description, event2.description, options);

    if ( overlappedEventLocation.length > 0 &&
      (overlappedEventName.length > 0 || overlappedEventDescription.length > 5)) {
      console.log(clc.magenta('Info: Duplicate event removed: ' + event1.url));
      console.log(clc.magenta('Info: Duplicate event added: ' + event2.url));
      console.log(clc.magenta('Info: Duplicate event overlaps [' + overlappedEventDescription.length + ']:' + overlappedEventDescription));
      console.log(clc.magenta('-----------'))
      return true;
    }
    return false;
  }

  function afterToday(evt) {
    return moment(evt.formatted_time, config.displayTimeformat) > moment();
  }

  function timeComparer(a, b) {
    return (moment(a.start_time).valueOf() -
            moment(b.start_time).valueOf());
  }

  function addEvents(type) {
    API[ 'get' + type + 'Events' ]().then(function(data) {
      data = data || [];
      var whiteEvents = data.filter(function(evt) {
        return !blacklistEvents.some(function(blackEvent) {
          return blackEvent.id.toString() === evt.id.toString();
        });
      });

      var beforeNum = eventsResult.events.length
      eventsResult.events = eventsResult.events.concat(whiteEvents);
      eventsResult.events = eventsResult.events.filter(afterToday);

      eventsResult.events.sort(timeComparer);
      eventsResult.events = removeDuplicates(eventsResult.events);
      eventsResult.meta.total_events = eventsResult.events.length;

      var afterNum = eventsResult.events.length
      logger.info(clc.green('Success: Added ' + (afterNum - beforeNum) + ' ' + type + ' events'));

      eventsToday.events = getCurrentDayData(eventsResult);
      eventsToday.meta.generated_at = eventsResult.meta.generated_at;
      eventsToday.meta.location = eventsResult.meta.location;
      eventsToday.meta.api_version = eventsResult.meta.api_version;
      eventsToday.meta.total_events = eventsToday.events.length;

      eventsHour.events = getCurrentHourData(eventsResult);
      eventsHour.meta.generated_at = eventsResult.meta.generated_at;
      eventsHour.meta.location = eventsResult.meta.location;
      eventsHour.meta.api_version = eventsResult.meta.api_version;
      eventsHour.meta.total_events = eventsToday.events.length;
    }).catch(function(err) {
      logger.error('Failed to add ' + type + ' events: HTTP Status Code ' + err.statusCode || err);
    });
  }

  function removeDuplicates(feed) {
    var uniqueEvents = [];
    var isDuplicate;

    feed.forEach(function(thisEvent) {
      isDuplicate = uniqueEvents.some(function(thatEvent) {
        return isDuplicateEvent(thisEvent, thatEvent);
      })

      if (!isDuplicate) {
        uniqueEvents.push(thisEvent);
      }
    })

    return uniqueEvents;
  }

  function getCurrentDayData(data) {
    return data.events.filter(function(element) {
      return moment(data.meta.generated_at).diff(moment(element.start_time), 'days') === 0;
    })
  }

  function getCurrentHourData(data) {
    return data.events.filter(function (element) {
      return moment(element.formatted_time, 'DD MMM YYYY, ddd, hh:mm a').isBefore(moment().add(1, 'hour'))
    })
  }

  return {
    feed: eventsResult,
    day: eventsToday,
    hour: eventsHour,
    get: function(count) {
      var answer = {
        meta: {
          'generated_at': new Date().toISOString(),
          'location': config.city,
          'api_version': config.api_version,
          'total_events': parseInt(count)
        },
        events: eventsResult.events.slice(0, parseInt(count))
      }

      return answer
    },
    update: function() {
      eventsResult.meta = {
        'generated_at': new Date().toISOString(),
        'location': config.city,
        'api_version': config.api_version
      }
      eventsResult.events = whitelistEvents.filter(afterToday);
      logger.info('Updating the events feed... this may take a while');
      addEvents('Meetup');
      addEvents('Facebook');
      addEvents('Eventbrite');
      addEvents('Ics');
    }
  }
};
