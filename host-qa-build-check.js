if (process.env.HOST_QA_PRIVATE_MARKER || process.env.HOST_QA_PROBE_TOKEN) {
  throw new Error('Private QA runtime configuration reached the build.')
}
if (process.env.HOST_QA_BUILD_CHECK === 'true' && ! /^[a-f0-9]{64}$/.test(process.env.HOST_QA_PUBLIC_MARKER || '')) {
  throw new Error('Public QA build configuration is missing.')
}
