// CI-only helper: patch the prebuild-generated Android project so release
// builds are signed with the keystore supplied through environment variables
// (GitHub Actions secrets). Runs right after `expo prebuild` in CI.
import fs from 'node:fs';
import path from 'node:path';

const gradlePath = path.join('android', 'app', 'build.gradle');
let src = fs.readFileSync(gradlePath, 'utf8').replaceAll('\r\n', '\n');

const signingAnchor = `    signingConfigs {
        debug {`;

const signingReplacement = `    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_FILE") ?: "release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
        debug {`;

if (src.includes('signingConfigs {\n        release {')) {
  throw new Error('ci-configure-signing: release signing config already present');
}
if (!src.includes(signingAnchor)) {
  throw new Error(
    'ci-configure-signing: signingConfigs block not found in android/app/build.gradle (template changed?)',
  );
}
src = src.replace(signingAnchor, signingReplacement);

const releaseAnchor = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

if (!src.includes(releaseAnchor)) {
  throw new Error(
    'ci-configure-signing: release buildType signing line not found (template changed?)',
  );
}
src = src.replace(releaseAnchor, '            signingConfig signingConfigs.release');

if (src.includes('signingConfigs.debug') && !src.includes('signingConfig signingConfigs.debug')) {
  throw new Error('ci-configure-signing: unexpected build.gradle state after patch');
}

fs.writeFileSync(gradlePath, src);
console.log('ci-configure-signing: release build now signs with the CI keystore.');
