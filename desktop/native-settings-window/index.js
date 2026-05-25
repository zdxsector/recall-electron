'use strict';

const path = require('path');

const binaryPath = path.join(
  __dirname,
  'build',
  'Release',
  'native_settings_window.node'
);

const unpackedBinaryPath = binaryPath.replace(
  `${path.sep}app.asar${path.sep}`,
  `${path.sep}app.asar.unpacked${path.sep}`
);

try {
  module.exports = require(binaryPath);
} catch (error) {
  if (unpackedBinaryPath !== binaryPath) {
    module.exports = require(unpackedBinaryPath);
  } else {
    throw error;
  }
}
