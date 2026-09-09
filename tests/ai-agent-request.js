const assert = require('node:assert/strict');
const { fetchAvailableAiModels, submitAiQuery } = require('../lib/api.js');

const originalFetch = global.fetch;
const requests = [];
let legacyServer = false;

global.fetch = async (url, init = {}) => {
  requests.push({ url, init });
  if (url.endsWith('model-provider/config')) {
    return {
      ok: true,
      json: async () => ({
        configs: [
          {
            id: 'provider-1',
            name: 'OpenAI',
            isDefault: true,
            defaultModelName: 'gpt-5',
          },
          {
            id: 'provider-2',
            name: 'Restricted',
            defaultModelName: 'hidden-model',
            privileges: { canCallModel: false },
          },
        ],
      }),
    };
  }
  if (url.endsWith('agent/conversations')) {
    if (legacyServer) {
      return {
        ok: false,
        status: 404,
        text: async () => '{"message":"Not Found","reason":null}',
      };
    }
    return {
      ok: true,
      json: async () => ({ conversationId: 'conversation-1', currentRunId: 'run-1' }),
    };
  }
  if (url.endsWith('agent/conversations/conversation-1/messages')) {
    return {
      ok: true,
      json: async () => ({ conversationId: 'conversation-1', currentRunId: 'run-2' }),
    };
  }
  if (url.endsWith('/agent')) {
    return {
      ok: true,
      text: async () => [
        'data: {"chunkType":"model","result":{"text":"Legacy response"},"sessionId":"session-1"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    };
  }
  return {
    ok: true,
    text: async () => [
      'data: {"chunkType":"model","result":{"text":"Hello"},',
      'data: "conversationId":"conversation-1"}',
      '',
      'data: {"chunkType":"model","result":{"text":"Hello from Dremio"},"conversationId":"conversation-1"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  };
};

(async () => {
  try {
    const creds = {
      url: 'https://api.dremio.cloud',
      token: 'cloud-token',
      direct: true,
      useTls: true,
      environment: 'cloud-gen2',
      projectId: 'project-id',
    };
    const models = await fetchAvailableAiModels(creds);
    assert.deepEqual(models.map(model => model.modelName), ['gpt-5']);
    assert.equal(requests[0].url, 'https://api.dremio.cloud/v1/model-provider/config');

    const response = await submitAiQuery(creds, 'Hello?', models[0]);
    assert.equal(requests[1].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations');
    assert.equal(requests[1].init.headers.Authorization, 'Bearer cloud-token');
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      message: 'Hello?',
      modelProviderId: 'provider-1',
    });
    assert.equal(requests[2].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations/conversation-1/runs/run-1');
    assert.deepEqual(response, {
      message: 'Hello from Dremio',
      conversation: { id: 'conversation-1', protocol: 'conversation' },
    });

    await submitAiQuery(creds, 'Follow up', models[0], response.conversation);
    assert.equal(requests[3].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations/conversation-1/messages');
    assert.deepEqual(JSON.parse(requests[3].init.body), {
      message: 'Follow up',
      modelProviderId: 'provider-1',
    });
    assert.equal(requests[4].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations/conversation-1/runs/run-2');

    requests.length = 0;
    legacyServer = true;
    const legacyResponse = await submitAiQuery(creds, 'Legacy?', models[0]);
    assert.equal(requests[0].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations');
    assert.equal(requests[1].url, 'https://api.dremio.cloud/v1/projects/project-id/agent');
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      message: 'Legacy?',
      modelProviderId: 'provider-1',
    });
    assert.deepEqual(legacyResponse, {
      message: 'Legacy response',
      conversation: { id: 'session-1', protocol: 'legacy' },
    });

    requests.length = 0;
    await submitAiQuery(creds, 'Legacy follow up', models[0], legacyResponse.conversation);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.dremio.cloud/v1/projects/project-id/agent');
    assert.equal(JSON.parse(requests[0].init.body).sessionId, 'session-1');

    requests.length = 0;
    legacyServer = false;
    const gen1Creds = { ...creds, environment: 'cloud-gen1' };
    const gen1Models = await fetchAvailableAiModels(gen1Creds);
    assert.equal(requests[0].url, 'https://api.dremio.cloud/v1/model-provider/config');
    await submitAiQuery(gen1Creds, 'Gen1?', gen1Models[0]);
    assert.equal(requests[1].url, 'https://api.dremio.cloud/v1/projects/project-id/agent/conversations');
    assert.equal(requests[1].init.headers.Authorization, 'Bearer cloud-token');

    requests.length = 0;
    const softwareCreds = {
      url: 'https://dremio.example',
      token: 'software-token',
      direct: true,
      useTls: true,
      environment: 'software',
    };
    const softwareModels = await fetchAvailableAiModels(softwareCreds);
    assert.equal(requests[0].url, 'https://dremio.example/api/v4/model-provider/config');
    assert.deepEqual(requests[0].init.headers, { Authorization: '_dremiosoftware-token' });
    await submitAiQuery(softwareCreds, 'Software?', softwareModels[0]);
    assert.equal(requests[1].url, 'https://dremio.example/api/v4/agent/conversations');
    assert.equal(requests[1].init.headers.Authorization, '_dremiosoftware-token');
    console.log('AI requests use callable models and the Dremio conversation run API.');
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
