'use strict';

var events, passport;

module.exports = {
  init: function(config){
    // console.log('invoked init with', config);

    events = require('./events')(config);
    passport = require('./events/setup-passport')(config);

    events.update();

    return {
      'events':events,
      'repos': repos,
    };
  }
};
