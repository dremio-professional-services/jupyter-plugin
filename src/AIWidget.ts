import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { DremioCredentials } from './api';
import { AIChat } from './components/AIChat';

export class AIWidget extends Widget {
  private _creds: DremioCredentials;
  private _mounted = false;
  private _onClosed: () => void;
  private _rendermime: IRenderMimeRegistry;

  constructor(creds: DremioCredentials, rendermime: IRenderMimeRegistry, onClosed: () => void) {
    super();
    this._creds = creds;
    this._rendermime = rendermime;
    this._onClosed = onClosed;
    this.id = 'jupyter-dremio:ai';
    this.title.label = 'Dremio AI';
    this.title.closable = true;
    this.addClass('jp-DremioAIWidget');
  }

  updateCreds(creds: DremioCredentials): void {
    this._creds = creds;
    if (this._mounted) this._render();
  }

  protected onAfterAttach(_msg: Message): void {
    this._mounted = true;
    this._render();
  }

  protected onBeforeDetach(_msg: Message): void {
    this._mounted = false;
    ReactDOM.unmountComponentAtNode(this.node);
  }

  protected onCloseRequest(msg: Message): void {
    super.onCloseRequest(msg);
    this._onClosed();
    this.dispose();
  }

  private _render(): void {
    ReactDOM.render(
      React.createElement(AIChat, {
        creds: this._creds,
        rendermime: this._rendermime,
        onClose: () => this.close(),
      }),
      this.node
    );
  }
}
