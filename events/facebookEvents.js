'use strict';

var querystring = require('querystring');
var Promise = require('promise');
var moment = require('moment-timezone');
var prequest = require('prequest');
var utils = require('./utils');
var fbBaseUrl = 'https://graph.facebook.com/v2.1/';
var clc = require('cli-color');

module.exports = function (config){
  var fbGroups = config.facebookGroups;
  function saveFacebookEvents(eventsWithVenues, row, grpIdx) {
    var thisGroupEvents = row.data || [];

    if (thisGroupEvents.length === 0) {
      return eventsWithVenues;
    }

    thisGroupEvents.forEach(function(row) {
      if (!row.location) {
        return;
      }
      if (!row.end_time){
        //TODO : add more sanitization checks for end_time
        row.end_time = utils.localTime(row.start_time, config.timezone).add(2, 'hours').toISOString();
      }

      eventsWithVenues.push({
        id: row.id,
        name: row.name,
        description: utils.htmlStrip(row.description),
        location: row.location,
        rsvp_count: row.attending_count,
        url: 'https://www.facebook.com/events/' + row.id,
        group_name: fbGroups[ grpIdx ].name,
        group_url: 'http://www.facebook.com/' + fbGroups[ grpIdx ].id,
        formatted_time: utils.formatLocalTime(row.start_time, config.timezone, config.displayTimeformat),
        start_time: utils.localTime(row.start_time, config.timezone).toISOString(),
        end_time: utils.localTime(row.end_time, config.timezone).toISOString()
      });
    });

    return eventsWithVenues;
  }

  function getFacebookUserEvents(userIdentity) {
    var groups = fbGroups.map(function(group) {
      return prequest(fbBaseUrl + group.id + '/events?' +
        querystring.stringify({
          since: moment().utc().utcOffset('+0800').format('X'),
          fields: 'description,name,end_time,location,timezone,attending_count',
          access_token: userIdentity.access_token
        })
      );
    });

    return new Promise(function(resolve, reject) {
      utils.waitAllPromises(groups).then(function(groupsEvents) {
        console.log(clc.blue('Info: Found ' + groupsEvents.length + ' facebook.com groups'));
        var eventsWithVenues = [];

        groupsEvents.reduce(saveFacebookEvents, eventsWithVenues);
        console.log(clc.blue('Info: Found ' + eventsWithVenues.length + ' facebook.com events'));
        resolve(eventsWithVenues);
      }).catch(function(err) {
        console.error(clc.red('Error: Getting facebook.com events with: ' + JSON.stringify(userIdentity)));
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

    return getFacebookUserEvents(user.identities[ 0 ])
    .then(function(events) {
      return events;
    }).catch(function(err) {
      console.error(err);
      return getAllFacebookEvents(users); // token failed. Try the next user's token
    })
  }

  // Get the FB user tokens from auth0
  function getFacebookUsers() {
    return new Promise(function(resolve, reject) {
      prequest('https://' + config.auth0.domain + '/oauth/token', {
        method: 'POST',
        body: {
          'client_id': config.auth0.clientId,
          'client_secret': config.auth0.clientSecret,
          'grant_type': 'client_credentials'
        }
      }).then(function(data) {
        prequest('https://' + config.auth0.domain + '/api/users', {
          headers: {
            'Authorization': data.token_type + ' ' + data.access_token
          }
        }).then(function(data) {
          resolve(data || []);
        });
      }).catch(function(err) {
        console.error(clc.red('Error: Getting Auth0 facebook.com users'));
        reject(err);
      })
    });
  }

  function filterValidFacebookUsers(users) { //must have access to groups
    var base = fbBaseUrl + '/me/groups?';
    var groupPromises;

    groupPromises = users.map(function(user) {
      return prequest(base +
        querystring.stringify({
          access_token: user.identities[ 0 ].access_token
        })
      );
    });

    return utils.waitAllPromises(groupPromises).then(function(userGroups) {
      var validusers

      console.log(clc.blue('Info: Found ' + userGroups.length + ' facebook.com authorized users'));
      validusers = users.filter(function(user, idx) {
        return userGroups[ idx ].data && userGroups[ idx ].data.length > 0
      });
      console.log(clc.blue('Info: Found ' + validusers.length + ' facebook.com users with accessible groups'));
      return validusers;
    }).catch(function(err) {
      console.error(clc.red('Error: Getting facebook.com groups with all user tokens: ' + err));
    });
  }

  return {
    'get': function(){
      return getFacebookUsers().then(function(allUsers) {
        return filterValidFacebookUsers(allUsers).then(function(users) {
          return getAllFacebookEvents(users);
        });
      }).catch(function(err) {
        console.error('getFacebookEvents(): ' + err);
      });
    }
  }
}
