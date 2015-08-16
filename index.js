'use strict';

var events, repos, passport;

module.exports = {
  init: function(config){
    // console.log('invoked init with', config);

    events = require('./events')(config);
    repos = require('./repos')(config);
    passport = require('./events/setup-passport')(config);

    events.update();
    repos.update();

    return {
      'events':events,
      'repos': repos,
      'passport': passport
    };
  }
};
