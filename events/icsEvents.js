'use strict';

var WBEvent = require('./WBEvent');
var ical = require('ical');
var getUrl = require('get-urls');
var utils = require('./utils');
var Promise = require('promise');
var moment = require('moment-timezone');
var clc = require('cli-color');
var logger = require('tracer').colorConsole({
  format: '{{timestamp}} <{{title}}> ({{path}}:{{line}}:{{pos}}:{{method}}) {{message}}',
  dateformat: 'mmm dd HH:MM:ss',
  preprocess:  function(data) {
    data.path = data.path.replace(process.cwd(), '');
  }
});

module.exports = function(config) {
  var icsGroups = config.icsGroups;

  function trimAfterAt(uid) {
    var trimAfterAtRegex = /(\w*)@.*/;
    return uid.match(trimAfterAtRegex)[ 1 ];
  }

  function getUrlfromDescriptionOrGroupUrl(eventToCheck) {
    if (eventToCheck.url && eventToCheck.url.length > 1) {
      return eventToCheck.url;
    } else if (!eventToCheck.description || eventToCheck.description.length < 1) {
      return eventToCheck.group_url;
    } else if (getUrl(eventToCheck.description)[ 0 ]) {
      return getUrl(eventToCheck.description)[ 0 ];
    } else {
      return eventToCheck.group_url;
    }
  }

  function hasLocation(eventToCheck) {
    if (eventToCheck.location.indexOf(config.city) >= 0) {
      return true;
    } else if (eventToCheck.location.indexOf(config.city.toLowerCase()) >= 0) {
      return true;
    } else if (eventToCheck.group_name === 'SG Hack & Tell') {
      return eventToCheck.location += ', ' + config.city;
    } else {
      return false;
    }
  }

  function isInFuture(eventToCheck) {
    return moment(eventToCheck.start_time).isAfter(moment());
  }

  function getAllIcsGroups(callback) {
    var events = [];
    var countReplies = 0;

    icsGroups.forEach(function(group) {
      ical.fromURL(group.ics_url, {}, function(err, data) {
        if (err) {
          logger.warn('Cannot read ICS Group ' + group.group_name + ': ' + err);
        } else {
          var thisEvent = {};

          for (var key in data) {
            if (data.hasOwnProperty(key)) {
              if (data[ key ].start && data[ key ].end) {
                thisEvent = {};
                thisEvent.group_name = group.group_name;
                thisEvent.group_url = group.group_url;
                thisEvent.start_time = data[ key ].start;
                thisEvent.end_time = data[ key ].end;
                thisEvent.uid = data[ key ].uid;
                thisEvent.name = data[ key ].summary;
                thisEvent.description = data[ key ].description;
                thisEvent.location = data[ key ].location;
                events.push(thisEvent);
              }
            }
          }
        }

        countReplies++;

        if (countReplies >= icsGroups.length) {
          callback(events);
        }
      });
    })
  }

  return {
    'get': function() {
      var normEvents;

      return new Promise(function(resolve) {
        getAllIcsGroups(function(events) {
          normEvents = events.map(function(ev) {
            var wbEvent = new WBEvent();

            wbEvent.id = trimAfterAt(ev.uid);
            wbEvent.name = ev.name || '';
            wbEvent.description = ev.description || '';
            wbEvent.location = ev.location || '';
            wbEvent.url = getUrlfromDescriptionOrGroupUrl(ev);
            wbEvent.group_name = ev.group_name;
            wbEvent.group_url = ev.group_url;
            wbEvent.formatted_time = utils.formatLocalTime(ev.start_time, config.timezone, config.displayTimeformat);
            wbEvent.start_time = utils.localTime(ev.start_time, config.timezone).toISOString();
            wbEvent.end_time = utils.localTime(ev.end_time, config.timezone).toISOString();

            return wbEvent;
          })

          normEvents = normEvents.filter(hasLocation);
          logger.info('Found ' + normEvents.length + ' ics events in total');
          normEvents = normEvents.filter(isInFuture);
          logger.info('Found ' + normEvents.length + ' ics future events in SG with location');

          resolve(normEvents);
        });
      });
    }
  }
}
