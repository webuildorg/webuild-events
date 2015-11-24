var versionFiles = [
  'package.json'
];
var jsFilesToCheck = [
  'Gruntfile.js',
  'events/**/*.js',
  'test/events/*.js'
];

module.exports = function(grunt) {
  'use strict';

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    bump: {
      options: {
        files: versionFiles,
        updateConfigs: [],
        commit: true,
        commitMessage: 'Release v%VERSION%',
        commitFiles: versionFiles,
        createTag: true,
        tagName: 'v%VERSION%',
        tagMessage: 'Version %VERSION%',
        push: true,
        pushTo: 'origin',
        gitDescribeOptions: '--tags --always --abbrev=1'
      }
    },
    jscs: {
      src: jsFilesToCheck,
      options: {
        config: '.jscsrc'
      }
    },
    jshint: {
      all: {
        options: {
          jshintrc: '.jshintrc'
        },
        src: jsFilesToCheck
      }
    }
  });

  grunt.loadNpmTasks('grunt-bump');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-jscs');

  grunt.registerTask('cleanup', 'Remove past events in blacklist and whitelist', function() {
    var cleanup = require('./events/cleanup');
    var blacklistEventsFilepath = __dirname  + '/events/blacklistEvents.json';
    var whitelistEventsFilepath =  __dirname  + '/events/whitelistEvents.json';
    var done = this.async();

    cleanup.all(blacklistEventsFilepath, cleanup.getEventsToKeep(blacklistEventsFilepath), function(reply) {
      grunt.log.writeln(reply);
      cleanup.all(whitelistEventsFilepath, cleanup.getEventsToKeep(whitelistEventsFilepath), function(reply) {
        grunt.log.writeln(reply);
        done();
      })
    })
  });

  grunt.registerTask('default', [
    'jshint',
    'jscs'
  ]);
};
