'use strict';

var querystring = require('querystring');
var prequest = require('prequest');
var moment = require('moment-timezone');
var utils = require('./utils');
var Promise = require('promise');

var logger = require('tracer').colorConsole({
  format: '{{timestamp}} <{{title}}> ({{path}}:{{line}}:{{pos}}:{{method}}) {{message}}',
  dateformat: 'mmm dd HH:MM:ss',
  preprocess:  function(data) {
    data.path = data.path.replace(process.cwd(), '');
  }
});

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
  var urlParamsForSearchVenue = function(eachEvent) {
    return {
      url: config.eventbriteParams.venueUrl + eachEvent.venue_id,
      headers: headers
    }
  }
  var urlParamsForSearchOrganizer = function(eachEvent) {
    return {
      url: config.eventbriteParams.organizerUrl + eachEvent.organizer_id,
      headers: headers
    }
  }

  function addEventbriteEvent(arr, event) {
    arr.push({
      id: event.id,
      name: event.name.text || '',
      description: event.description.text || '',
      location: event.location,
      url: event.url,
      group_id: event.organizer_id,
      group_name: event.organizer ? event.organizer.name : '',
      group_url: event.organizer ? event.organizer.url : '',
      formatted_time: utils.formatLocalTime(event.start.utc, config.timezone, config.displayTimeformat),
      start_time: utils.localTime(event.start.utc, config.timezone).toISOString(),
      end_time: utils.localTime(event.end.utc, config.timezone).toISOString(),
      platform: 'eventbrite'
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
      return thisEvent.organizer_id !== ''+id
    })
  }

  var getEventsForPage = function(pageNum) {
    return prequest(urlParamsForSearch(pageNum))
  }

  function getEventVenue(events) {
    var eventVenueSearchResults = []

    events.forEach(function(eachEvent) {
      var searchResult = prequest(urlParamsForSearchVenue(eachEvent)).then(function(addr) {
        eachEvent.addr = addr
      })

      eventVenueSearchResults.push(searchResult)
    })

    return utils.waitAllPromises(eventVenueSearchResults)
  }

  function getEventOrganizer(events) {
    var eventOrgSearchResults = []

    events.forEach(function(eachEvent) {
      var searchResult = prequest(urlParamsForSearchOrganizer(eachEvent)).then(function(org) {
        eachEvent.organizer = org
      })

      eventOrgSearchResults.push(searchResult)
    })

    return utils.waitAllPromises(eventOrgSearchResults)
  }

  function filterEvents(allEvents, resolve, reject) {
    var techEvents
    var whitelistEvents
    var events = []

    techEvents = allEvents.filter(isInTechCategory)
    logger.info('Found ' + techEvents.length + ' eventbrite.com tech events')

    getEventVenue(techEvents).then(function() {
      techEvents = techEvents.filter(hasVenue)
      techEvents.forEach(function(eachEvent) {
        eachEvent.location = constructLocation(eachEvent.addr)
      })

      logger.info('Found ' + techEvents.length + ' eventbrite.com with valid location')

      whitelistEvents = techEvents.filter(isInWhitelist);
      logger.info('Found ' + whitelistEvents.length + ' allowed eventbrite.com events')

      getEventOrganizer(whitelistEvents).then(function() {
        whitelistEvents.reduce(addEventbriteEvent, events)
        resolve(events)
      }).catch(function(err) {
        logger.error('Getting eventbrite.com event organizers')
        logger.error('Status code: ', err.statusCode)
        logger.error('Message: ', err.message)
        logger.error(err)
        logger.error(err.stack)
        reject(err)
      })
    }).catch(function(err) {
      logger.error('Status code: ', err.statusCode)
      logger.error('Message: ', err.message)
      logger.error(err.body)
      logger.error(err.stack)
      reject(err)
    })
  }

  return {
    'get': function() {
      var allEvents

      return getEventsForPage(1).then(function(data) {
        logger.info('Found ' + data.pagination.object_count + ' eventbrite.com free events found in ' + config.city + ' in ' + data.pagination.page_count + ' pages')
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

            filterEvents(allEvents, resolve, reject)
          }).catch(function(err) {
            logger.error('Getting eventbrite.com events')
            logger.error(err)
            logger.error(err.stack)
            reject(err)
          })
        })
      })
    }
  }
}
