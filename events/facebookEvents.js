'use strict';

var querystring = require('querystring');
var Promise = require('promise');
var moment = require('moment-timezone');
var prequest = require('prequest');
var utils = require('./utils');
var fbBaseUrl = 'https://graph.facebook.com/v2.6/';
var clc = require('cli-color');
var logger = require('tracer').colorConsole({
  format: '{{timestamp}} <{{title}}> ({{path}}:{{line}}:{{pos}}:{{method}}) {{message}}',
  dateformat: 'mmm dd HH:MM:ss',
  preprocess:  function(data) {
    data.path = data.path.replace(process.cwd(), '');
  }
});

module.exports = function (config) {
  var fbGroups = config.facebookGroups;

  function constructAddress(venue) {
    var address = '';

    if (venue) {
      address = [
        venue.name,
        ', ',
        venue.location ? venue.location.street || '' : ''
      ].join('');
      address += address.indexOf(config.meetupParams.city) === -1 ? ', ' + config.meetupParams.city : '';
      address +=  venue.location ? (' ' + venue.location.zip) || '' : ''
    } else {
      address = config.meetupParams.city;
    }

    return address;
  }

  function locationHasTBC(place) {
    return place.toLowerCase().includes('tbc')
  }

  function generateEventObjectPerEvent(eventsArray, groupEvent, grpIdx) {
    var thisGroupEvents = groupEvent.data || [];

    if (thisGroupEvents.length === 0) {
      return eventsArray;
    }

    thisGroupEvents.forEach(function(row) {
      if (!row.place) {
        return;
      }

      if (locationHasTBC(row.place.name)) {
        return;
      }

      if (!row.end_time){
        //TODO : add more sanitization checks for end_time
        row.end_time = utils.localTime(row.start_time, config.timezone).add(2, 'hours').toISOString();
      }

      var eachEvent = {
        id: row.id,
        name: row.name,
        description: utils.htmlStrip(row.description),
        location: constructAddress(row.place),
        rsvp_count: row.attending_count,
        url: 'https://www.facebook.com/events/' + row.id,
        group_id: fbGroups[ grpIdx ].id,
        group_name: fbGroups[ grpIdx ].name,
        group_url: 'http://www.facebook.com/' + fbGroups[ grpIdx ].id,
        formatted_time: utils.formatLocalTime(row.start_time, config.timezone, config.displayTimeformat),
        start_time: utils.localTime(row.start_time, config.timezone).toISOString(),
        end_time: utils.localTime(row.end_time, config.timezone).toISOString(),
        platform: 'facebook'
      };

      if (row.place.location) {
        eachEvent.latitude = row.place.location.latitude;
        eachEvent.longitude = row.place.location.longitude;
      }

      eventsArray.push(eachEvent);
    });

    return eventsArray;
  }

  function getFacebookEvents(user) {
    var groupRequests = fbGroups.map(function(group) {
      return prequest(fbBaseUrl + group.id + '/events?' +
        querystring.stringify({
          since: moment().utc().utcOffset('+0800').format('X'),
          fields: 'description,name,end_time,start_time,place,timezone,attending_count',
          access_token: user.access_token
        })
      );
    });

    return new Promise(function(resolve, reject) {
      utils.waitAllPromises(groupRequests).then(function(eventsForAllGroups) {
        logger.info('Found ' + eventsForAllGroups.length + ' facebook.com group');
        var eventsArray = [];

        eventsForAllGroups.reduce(generateEventObjectPerEvent, eventsArray);

        logger.info('Found ' + eventsArray.length + ' facebook.com events with venue');

        resolve(eventsArray);
      }).catch(function(err) {
        logger.error(clc.red('Error: Getting facebook.com events with: ' + JSON.stringify(user)));
        reject(err);
      });
    });
  }

  // Recursively try all available user access tokens (some may have expired)
  //  until one is able to return facebook.com events.
  //  We assume that all access tokens are able to access all white listed fb groups.
  function getAllFacebookEvents(users) {
    if (users.length === 0) {
      return [];
    }

    var user = users.pop();

    return getFacebookEvents(user.identities[ 0 ])
    .then(function(events) {
      return events;
    }).catch(function(err) {
      logger.error(clc.red(err));
      return getAllFacebookEvents(users); // token failed. Try the next user's token
    })
  }

  // Get the FB user tokens from auth0
  function getFacebookUsersfromAuth0() {
    return new Promise(function(resolve, reject) {
      prequest('https://' + config.auth0.domain + '/api/v2/users', {
        'auth': {
          'bearer': config.auth0.clientToken
        }
      }).then(function(data) {
        resolve(data || []);
      }).catch(function(err) {
        logger.error(clc.red('Error: Getting Auth0 facebook.com users' + err));
        reject(err.body);
      });
    });
  }

  function filterValidFacebookUsers(facebookUsers) { //must have access to groupRequests
    var base = fbBaseUrl + '/me/groupRequests?';
    var groupPromises;

    groupPromises = facebookUsers.map(function(user) {
      return prequest(base +
        querystring.stringify({
          access_token: user.identities[ 0 ].access_token
        })
      );
    });

    return utils.waitAllPromises(groupPromises).then(function(usersWithGroups) {
      var validusers

      logger.info('Found ' + usersWithGroups.length + ' facebook.com authorized users');

      validusers = facebookUsers.filter(function(user, idx) {
        return usersWithGroups[ idx ].data && usersWithGroups[ idx ].data.length > 0
      });

      logger.info('Found ' + validusers.length + ' facebook.com users with accessible groupRequests');
      return validusers;
    }).catch(function(err) {
      logger.error('Getting facebook.com groupRequests with all user tokens: ' + err);
    });
  }

  return {
    'get': function() {
      return getFacebookUsersfromAuth0().then(function(allFacebookUsers) {
        return filterValidFacebookUsers(allFacebookUsers).then(function(validFacebookUsers) {
          return getAllFacebookEvents(validFacebookUsers);
        });
      }).catch(function(err) {
        logger.error(err);
      });
    }
  }
}
