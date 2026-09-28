function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Tolgee sync`);
  }
  return value;
}

module.exports = {
  apiUrl: requireEnv('TOLGEE_API_URL'),
  apiKey: requireEnv('TOLGEE_API_KEY'),
  projectId: Number(requireEnv('TOLGEE_PROJECT_ID')),
  format: 'JSON_TOLGEE',
  delimiter: null,
  push: {
    filesTemplate: './messages/{languageTag}.json',
  },
};
