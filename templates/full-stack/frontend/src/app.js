export const BACKEND_STATUS = Object.freeze({
  LOADING: 'loading',
  HEALTHY: 'healthy',
  UNAVAILABLE: 'unavailable',
});

export const STATUS_ELEMENT_ID = 'backend-status';
export const RETRY_BUTTON_ID = 'retry-backend';

const STATUS_MESSAGES = Object.freeze({
  [BACKEND_STATUS.LOADING]: 'Status: checking backend...',
  [BACKEND_STATUS.HEALTHY]: 'Status: backend healthy',
  [BACKEND_STATUS.UNAVAILABLE]:
    'Status: backend unavailable. Use Retry backend status to try again.',
});

const RETRY_LABEL = 'Retry backend status';

export function createAppModel() {
  return {
    name: '{{projectName}}',
    network: 'Stellar Testnet',
    backendHealthPath: '/health',
  };
}

export function createStatusView(state, attempt = 0) {
  const message = STATUS_MESSAGES[state];
  if (message === undefined) {
    throw new Error(`Unknown backend status: ${state}`);
  }

  return Object.freeze({
    state,
    message,
    retryLabel: RETRY_LABEL,
    isLoading: state === BACKEND_STATUS.LOADING,
    attempt,
  });
}

export function createBackendStatusClient({
  fetchImpl = globalThis.fetch,
  healthPath = '/health',
  onStatusChange = () => {},
} = {}) {
  let state = BACKEND_STATUS.LOADING;
  let attempt = 0;
  let inFlight = false;

  const getState = () => createStatusView(state, attempt);

  const notify = () => {
    onStatusChange(getState());
  };

  const refresh = async () => {
    if (inFlight) {
      return getState();
    }

    inFlight = true;
    attempt += 1;
    state = BACKEND_STATUS.LOADING;
    notify();

    try {
      if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable');
      }

      const response = await fetchImpl(healthPath, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('backend returned an error');
      }

      const payload = await response.json();
      if (payload?.status !== 'ok') {
        throw new Error('backend returned an unexpected payload');
      }

      state = BACKEND_STATUS.HEALTHY;
    } catch {
      state = BACKEND_STATUS.UNAVAILABLE;
    } finally {
      inFlight = false;
      notify();
    }

    return getState();
  };

  return Object.freeze({ getState, refresh });
}

export function renderBackendStatus(view, elements) {
  const { statusElement, retryButton } = elements;

  statusElement.textContent = view.message;
  statusElement.setAttribute('data-state', view.state);
  statusElement.setAttribute('aria-busy', String(view.isLoading));
  statusElement.className = `status status--${view.state}`;
  retryButton.disabled = view.isLoading;
  retryButton.textContent = view.retryLabel;

  return { statusElement, retryButton };
}

export function mountApp(document = globalThis.document, options = {}) {
  const statusElement = document.getElementById(STATUS_ELEMENT_ID);
  const retryButton = document.getElementById(RETRY_BUTTON_ID);

  if (!statusElement || !retryButton) {
    throw new Error(
      'Full Stack starter markup is missing the backend status elements.',
    );
  }

  const controller = createBackendStatusClient({
    ...options,
    onStatusChange: (view) => {
      renderBackendStatus(view, { statusElement, retryButton });
      options.onStatusChange?.(view);
    },
  });

  retryButton.addEventListener('click', () => {
    void controller.refresh();
  });

  renderBackendStatus(controller.getState(), { statusElement, retryButton });
  void controller.refresh();

  return controller;
}
