'use strict';

var querystring = require('querystring');
var prequest = require('prequest');
var utils = require('./utils');
var clc = require('cli-color');
var logger = require('tracer').colorConsole({
  format: '{{timestamp}} <{{title}}> ({{path}}:{{line}}:{{pos}}:{{method}}) {{message}}',
  dateformat: 'mmm dd HH:MM:ss',
  preprocess:  function(data) {
    data.path = data.path.replace(process.cwd(), '');
  }
});

module.exports = function (config) {
  var blacklistGroups = config.meetupParams.blacklistGroups || [];

  function constructAddress(venue) {
    var address = '';

    if (venue) {
      address = [
        venue.name,
        ', ',
        venue.address_1 || '',
        (venue.address_2 ? ', ' + venue.address_2 : '')
      ].join('');
      address += address.indexOf(config.meetupParams.city) === -1 ? ', ' + config.meetupParams.city : '';
    } else {
      address = config.meetupParams.city;
    }

    return address;
  }

  function hasWord(phrase, word) {
    phrase && phrase.toLowerCase().includes(word) ? true : false;
  }

  function hasValidAddress(event) {
    var matchWords = [ 'tbd', 'to be decided' ];
    var countMatch = 0;

    [ event.venue.name,  event.venue.address_1, event.venue.address_2 ].forEach(function(eachAddressPhrase) {
      matchWords.forEach(function(eachMatchWord) {
        if (eachAddressPhrase && eachAddressPhrase.toLowerCase().includes(eachMatchWord)) {
          console.log('Remove event ' + event.name + ' for venue with TBD.')
          countMatch++;
        }
      })
    })

    return countMatch > 0 ? false : true;
  }

  function isValidGroup(row) {
    // console.log(row.category.id, row.country, row.id, row.name)
    var isValidCountry = row.country === (config.meetupParams.country || row.country)
    var isValidGroupId = !blacklistGroups.some(function(id) { return row.id === id });

    return isValidCountry && isValidGroupId;
  }

  function isFree(event) {
    return !event.fee;
  }

  function normalizeGroupEvents(events, row) {
    var eventTime;
    var event = {};

    if (!isFree(row)) {
      return events;
    }

    if (!row.hasOwnProperty('venue') || row.venue_visibility === 'members') {
      return events;
    }

    if (!hasValidAddress(row)) {
      return events;
    }

    if (row.duration === undefined) {
      row.duration = 7200000
    }

    eventTime = utils.localTime(row.time, config.timezone);

    event = {
      id: row.id,
      name: row.name,
      description: utils.htmlStrip(row.description),
      location: constructAddress(row.venue),
      rsvp_count: row.yes_rsvp_count,
      url: row.event_url,
      group_id: row.group.id,
      group_name: row.group.name,
      group_url: 'http://meetup.com/' + row.group.urlname,
      formatted_time: utils.formatLocalTime(row.time, config.timezone, config.displayTimeformat),
      start_time: eventTime.toISOString(),
      end_time: eventTime.add(row.duration, 'milliseconds').toISOString()
    }

    if (row.venue.lat !== 0 && row.venue.lon !== 0) {
      event.latitude = row.venue.lat;
      event.longitude = row.venue.lon
    }

    events.push(event);
    return events;
  }

  // getEventsByGroupIds returns an array of events
  // for the provided groups.
  function getEventsByGroupIds(groupIds) {
    var url = 'https://api.meetup.com/2/events/?' +
    querystring.stringify({
      key: config.meetupParams.key,
      group_id: groupIds.join(',')
    });

    return prequest(url).then(function(data) {
      var events = [];
      data.results.reduce(normalizeGroupEvents, events);
      logger.info('Info: Found ' + events.length + ' meetup.com group events with venues');
      return events;
    }).catch(function(err) {
      logger.error('Error: getEventsByGroupIds():');
      logger.error(err);
    });
  }

  // getGroupIds returns an array of group IDs
  // matching the given criteria.
  function getGroupIds(offset) {
    config.meetupParams.offset = offset
    var url = 'https://api.meetup.com/2/groups?' + querystring.stringify(config.meetupParams);

    return prequest(url).then(function(data) {
      logger.info(`Found ${data.results.length} meetup.com groups with offset=${offset}`);

      return data.results
        .filter(isValidGroup)
        .reduce(function(groupIds, row) {
          groupIds.push(row.id);
          return groupIds;
        }, []);
    }).catch(function(err) {
      logger.error(err);
    });
  }

  return {
    'get': function () {
      return getGroupIds(0).then(function(groupIdsOffset0) {
        return getGroupIds(1).then(function(groupsIdsOffset1) {
          return getEventsByGroupIds(groupIdsOffset0.concat(groupsIdsOffset1))
        }).catch(function(err) {
          logger.error(err)
        })
      }).catch(function(err) {
        logger.error(err)
      })
    }
  }
}
