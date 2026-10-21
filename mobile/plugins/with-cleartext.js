// OpenCode serves plain HTTP on the LAN. Android blocks cleartext by default
// for apps targeting API 28+, so a LAN pairing link is unreachable in a release
// build unless the manifest opts in. Keep this explicit: the app still defaults
// to the HTTPS tunnel, and the README warns that LAN traffic is unencrypted.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });
};
