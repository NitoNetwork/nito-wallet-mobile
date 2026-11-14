#!/usr/bin/env bash
set -euo pipefail

if (( $# != 5 )); then
  echo "Usage: $0 <android-cli> <sdk-directory> <platform-package> <build-tools-version> <ndk-version>" >&2
  exit 64
fi

android_cli="$1"
sdk_directory="$2"
platform_package="$3"
build_tools_version="$4"
ndk_version="$5"

max_attempts="${NITO_ANDROID_SDK_INSTALL_ATTEMPTS:-3}"
retry_delay_seconds="${NITO_ANDROID_SDK_INSTALL_RETRY_DELAY_SECONDS:-15}"

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]] || (( max_attempts > 5 )); then
  echo "NITO_ANDROID_SDK_INSTALL_ATTEMPTS must be between 1 and 5." >&2
  exit 64
fi

if [[ ! "$retry_delay_seconds" =~ ^[0-9]+$ ]] || (( retry_delay_seconds > 60 )); then
  echo "NITO_ANDROID_SDK_INSTALL_RETRY_DELAY_SECONDS must be between 0 and 60." >&2
  exit 64
fi

test -x "$android_cli"
mkdir -p "$sdk_directory"

working_directory="${RUNNER_TEMP:-$PWD}"
log_directory="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
mkdir -p "$log_directory"
attempt_logs=()

for (( attempt = 1; attempt <= max_attempts; attempt += 1 )); do
  echo "Android SDK installation attempt ${attempt}/${max_attempts}."
  attempt_log="$(mktemp "${log_directory%/}/nito-android-sdk-install-${attempt}-XXXXXX.log")"
  attempt_logs+=("$attempt_log")

  verbosity=()
  if (( attempt == max_attempts )); then
    verbosity=(-vv)
  fi

  set +e
  (
    cd "$working_directory"
    "$android_cli" \
      "${verbosity[@]}" \
      --no-metrics \
      --sdk="$sdk_directory" \
      sdk install \
      "$platform_package" \
      "build-tools/$build_tools_version" \
      "ndk/$ndk_version"
  ) >"$attempt_log" 2>&1
  install_status=$?
  set -e

  if (( install_status == 0 )); then
    cat "$attempt_log"
    rm -f "${attempt_logs[@]}"
    exit 0
  fi

  if (( attempt == max_attempts )); then
    for failed_log in "${attempt_logs[@]}"; do
      echo "===== ${failed_log##*/} =====" >&2
      cat "$failed_log" >&2
    done
    echo "Android SDK installation exhausted ${max_attempts} attempts." >&2
    exit "$install_status"
  fi

  delay=$(( retry_delay_seconds * attempt ))
  echo "Android SDK installation attempt ${attempt} failed with status ${install_status}; retrying in ${delay} seconds."
  sleep "$delay"
done

exit 1
