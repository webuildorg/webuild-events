'use strict';

var querystring = require('querystring');
var prequest = require('prequest');
var moment = require('moment-timezone');
var utils = require('./utils');
var Promise = require('promise');
var clc = require('cli-color');

module.exports = function(config) {
  var baseUrl = config.eventbriteParams.url;
  var techCategories = config.eventbriteParams.categories;
  var headers = {
    Authorization: 'Bearer ' + config.eventbriteParams.token
  }
  var urlParamsForSearch = function(pageNum) {
    return {
      url: baseUrl + '?' + querystring.stringify({
        'venue.country': config.symbol,
        'venue.city': config.city,
        'start_date.range_end': moment().add(2, 'months').format('YYYY-MM-DD') + 'T00:00:00Z',
        'page': pageNum,
        'price': 'free'
      }),
      headers: headers
    }
  }
  var urlParamsForSearchVenue = {
    url: config.eventbriteParams.venueUrl + eachEvent.venue_id,
    headers: headers
  }
  var urlParamsForSearchOrganizer = {
    url: config.eventbriteParams.organizerUrl + eachEvent.organizer_id,
    headers: headers
  }

  function addEventbriteEvent(arr, event) {
    arr.push({
      id: event.id,
      name: event.name.text || '',
      description: event.description.text || '',
      location: event.location,
      url: event.url,
      group_name: event.organizer.name,
      group_url: event.organizer.url,
      formatted_time: utils.formatLocalTime(event.start.utc, config.timezone, config.displayTimeformat),
      start_time: event.start.utc,
      end_time: event.end.utc
    })

    return arr
  }

  function constructLocation(venue) {
    var addr = venue.address;
    return [
      venue.name ? venue.name.trimRight() : '',
      addr.address_1 ? ', ' + addr.address_1.trimRight() : '',
      addr.address_2 ? ', ' + addr.address_2.trimRight() : '',
      ', ',
      addr.city + ' ' + addr.postal_code
    ].join('');
  }

  function hasVenue(event) {
    var addr = event.addr.address
    return event.addr.name && addr.city && addr.address_1
  }

  function isInTechCategory(event) {
    return event && event.category_id && techCategories.indexOf(event.category_id) >= 0
  }

  function isInWhitelist(thisEvent) {
    return config.eventbriteParams.blacklistOrganiserId.every(function(id) {
      return thisEvent.organizer_id != id
    })
  }

  return {
    'get': function() {
      var allEvents
      var getEventsForPage = function(pageNum) {
        return prequest(urlParamsForSearch(pageNum))
      };

      return getEventsForPage(1).then(function(data) {
        console.log(clc.blue('Info: Found ' + data.pagination.object_count + ' eventbrite.com free events found in ' + config.city + ' in ' + data.pagination.page_count + ' pages'))
        allEvents = data.events

        var promisesArray = []
        var pageCount

        for (pageCount = 2; pageCount <= data.pagination.page_count; pageCount++) {
          promisesArray.push(getEventsForPage(pageCount))
        }

        return new Promise(function(resolve, reject) {
          utils.waitAllPromises(promisesArray).then(function(dataArray) {
            dataArray.forEach(function(data) {
              allEvents = allEvents.concat(data.events)
            })

            var techEvents
            var freeEventsWithVenue
            var whitelistEvents
            var events = []
            var eventVenueSearchResults = []
            var eventOrgSearchResults = []

            techEvents = allEvents.filter(isInTechCategory)
            console.log(clc.blue('Info: Found ' + techEvents.length + ' eventbrite.com tech events'))

            techEvents.forEach(function(eachEvent) {
              var searchResult = prequest(urlParamsForSearchVenue).then(function(addr) {
                eachEvent.addr = addr
              })

              eventVenueSearchResults.push(searchResult)
            })

            utils.waitAllPromises(eventVenueSearchResults).then(function() {
              techEvents = techEvents.filter(hasVenue)
              techEvents.forEach(function(eachEvent) {
                eachEvent.location = constructLocation(eachEvent.addr)
              })

              console.log(clc.blue('Info: Found ' + techEvents.length + ' eventbrite.com with valid location'))

              whitelistEvents = techEvents.filter(isInWhitelist);
              console.log(clc.blue('Info: Found ' + whitelistEvents.length + ' allowed eventbrite.com events'))

              whitelistEvents.forEach(function(eachEvent) {
                var searchResult = prequest(urlParamsForSearchOrganizer).then(function(org) {
                  eachEvent.organizer = org
                })

                eventOrgSearchResults.push(searchResult)
              })

              utils.waitAllPromises(eventOrgSearchResults).then(function() {
                whitelistEvents.reduce(addEventbriteEvent, events)
                resolve(events)
              })
            })
          }).catch(function(err) {
            console.error(clc.red('Error: Getting eventbrite.com events'))
            console.error(clc.red(err))
            console.error(clc.red(err.stack))
            reject(err)
          })
        })
      })
    }
  }
}
