import * as React from 'react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { IRenderMimeRegistry, renderMarkdown } from '@jupyterlab/rendermime';
import {
  AiModel,
  AiConversation,
  DremioCredentials,
  fetchAvailableAiModels,
  submitAiQuery,
} from '../api';

interface Props {
  creds: DremioCredentials;
  rendermime: IRenderMimeRegistry;
  onClose: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function modelKey(model: AiModel): string {
  return `${model.providerId}:${model.modelName}`;
}

function MarkdownMessage({ source, rendermime }: {
  source: string;
  rendermime: IRenderMimeRegistry;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let active = true;
    node.textContent = '';
    void renderMarkdown({
      host: node,
      source,
      trusted: false,
      sanitizer: rendermime.sanitizer,
      resolver: rendermime.resolver,
      linkHandler: rendermime.linkHandler,
      shouldTypeset: true,
      latexTypesetter: rendermime.latexTypesetter,
      markdownParser: rendermime.markdownParser,
    }).catch(() => {
      if (active) node.textContent = source;
    });
    return () => { active = false; };
  }, [source, rendermime]);

  return <div ref={host} className="dremio-ai-markdown jp-RenderedHTMLCommon" />;
}

export function AIChat({ creds, rendermime, onClose }: Props): JSX.Element {
  const [models, setModels] = useState<AiModel[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelsUnavailable, setModelsUnavailable] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [conversation, setConversation] = useState<AiConversation>();
  const [error, setError] = useState<string | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    setModelsUnavailable(false);
    setModelLoadError(null);
    fetchAvailableAiModels(creds)
      .then(nextModels => {
        if (!active) return;
        setModels(nextModels);
        const defaultModel = nextModels.find(model => model.isDefault) ?? nextModels[0];
        setSelectedKey(defaultModel ? modelKey(defaultModel) : '');
        setModelsUnavailable(nextModels.length === 0);
      })
      .catch(reason => {
        if (!active) return;
        setModels([]);
        setSelectedKey('');
        setModelLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [creds]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, submitting]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    const model = models.find(candidate => modelKey(candidate) === selectedKey);
    if (!text || !model || submitting) return;
    setMessages(previous => [...previous, { role: 'user', text }]);
    setPrompt('');
    setSubmitting(true);
    setError(null);
    try {
      const response = await submitAiQuery(creds, text, model, conversation);
      setConversation(response.conversation);
      setMessages(previous => [...previous, { role: 'assistant', text: response.message }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const noModelsMessage = 'You cannot use the AI Agent because no model providers grant you CALL MODEL. Contact your Dremio administrator if you believe this is incorrect.';

  return (
    <div className="dremio-ai-chat">
      <div className="dremio-ai-header">
        <strong>Dremio AI</strong>
        <button className="dremio-ai-close" onClick={onClose} title="Close Dremio AI" aria-label="Close Dremio AI">×</button>
      </div>
      <div className="dremio-ai-model-field">
        <label htmlFor="dremio-ai-model">Model provider</label>
        <select
          id="dremio-ai-model"
          value={selectedKey}
          disabled={loadingModels || models.length <= 1}
          onChange={event => {
            setSelectedKey(event.target.value);
            setConversation(undefined);
            setMessages([]);
          }}
        >
          {loadingModels && <option value="">Loading models…</option>}
          {!loadingModels && models.length === 0 && <option value="" />}
          {models.map(model => (
            <option key={modelKey(model)} value={modelKey(model)}>
              {model.providerName} · {model.modelName}
            </option>
          ))}
        </select>
        {modelsUnavailable && <div className="dremio-ai-unavailable" role="alert">{noModelsMessage}</div>}
        {modelLoadError && <div className="dremio-ai-unavailable" role="alert">Could not load Dremio AI models: {modelLoadError}</div>}
      </div>
      <div className="dremio-ai-messages" aria-live="polite">
        {messages.length === 0 && !modelsUnavailable && !modelLoadError && (
          <div className="dremio-ai-empty">Ask Dremio about your data.</div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`dremio-ai-message dremio-ai-message--${message.role}`}>
            <span>{message.role === 'user' ? 'You' : 'Dremio AI'}</span>
            {message.role === 'assistant'
              ? <MarkdownMessage source={message.text} rendermime={rendermime} />
              : <div>{message.text}</div>}
          </div>
        ))}
        {submitting && <div className="dremio-ai-thinking">Dremio is working…</div>}
        {error && <div className="dremio-ai-error" role="alert">{error}</div>}
        <div ref={messagesEnd} />
      </div>
      <form className="dremio-ai-composer" onSubmit={event => { void handleSubmit(event); }}>
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask Dremio…"
          aria-label="Ask Dremio AI"
          disabled={modelsUnavailable || Boolean(modelLoadError) || loadingModels || submitting}
          rows={3}
        />
        <button type="submit" disabled={!prompt.trim() || !selectedKey || submitting}>Send</button>
      </form>
    </div>
  );
}
