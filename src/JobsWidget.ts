import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { DremioCredentials } from './api';
import { JobsViewer } from './components/JobsViewer';

export class JobsWidget extends Widget {
  private _creds: DremioCredentials;
  private _mounted = false;

  constructor(creds: DremioCredentials) {
    super();
    this._creds = creds;
    this.id = 'jupyter-dremio:jobs';
    this.title.label = 'Dremio Jobs';
    this.title.closable = true;
    this.addClass('jp-DremioJobsWidget');
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

  private _render(): void {
    ReactDOM.render(
      React.createElement(JobsViewer, { creds: this._creds }),
      this.node
    );
  }
}
