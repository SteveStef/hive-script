// In-game dialogs, in place of the browser's prompt() and confirm(): a wax panel over the game,
// built from the DOM (never innerHTML), so names the player types are always shown as plain text.

interface PromptOptions {
  title: string;
  message: string;
  placeholder?: string;
  suffix?: string; // shown after the input, like ".bee"
  confirmLabel: string;
  /** Why a value can't be used, or null when it can. Checked as the player types. */
  validate: (value: string) => string | null;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean; // for deleting things: the confirm button turns red
}

/** Asks for a line of text. Resolves to the trimmed value, or null if the player cancels. */
export function promptDialog(o: PromptOptions): Promise<string | null> {
  const input = el('input', 'dialog-input');
  input.type = 'text';
  input.placeholder = o.placeholder ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const field = el('label', 'dialog-field');
  field.append(input);
  if (o.suffix) field.append(text('span', 'dialog-suffix', o.suffix));
  const problem = text('p', 'dialog-problem', '');

  return open(o.title, o.message, [field, problem], o.confirmLabel, false, (ok, dialog) => {
    const check = () => {
      const value = input.value.trim();
      const why = o.validate(value);
      // say what's wrong only once there's something typed; an empty box just can't be submitted yet
      problem.textContent = value ? (why ?? '') : '';
      ok.disabled = why !== null;
      return why === null ? value : null;
    };
    input.addEventListener('input', check);
    check();
    setTimeout(() => input.focus());
    return () => (dialog.returnValue === 'ok' ? check() : null);
  });
}

/** Asks a yes-or-no question. Resolves to true if the player confirms. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return open(o.title, o.message, [], o.confirmLabel, !!o.danger, (ok, dialog) => {
    setTimeout(() => ok.focus());
    return () => dialog.returnValue === 'ok';
  });
}

/**
 * Shows a modal dialog and resolves when it closes. setup wires up the body and returns a
 * function that reads the result once the dialog is closed (Escape and Cancel both close it).
 */
function open<T>(
  title: string,
  message: string,
  body: HTMLElement[],
  confirmLabel: string,
  danger: boolean,
  setup: (ok: HTMLButtonElement, dialog: HTMLDialogElement) => () => T,
): Promise<T> {
  const dialog = el('dialog', 'game-dialog');
  const form = el('form', 'dialog-form');
  form.method = 'dialog';
  const cancel = text('button', 'pbtn quiet', 'Cancel');
  cancel.value = 'cancel';
  cancel.type = 'submit';
  cancel.formNoValidate = true;
  const ok = text('button', danger ? 'pbtn danger' : 'pbtn', confirmLabel);
  ok.value = 'ok';
  ok.type = 'submit';
  // the confirm button comes first, so Enter (which presses a form's first button) confirms;
  // CSS shows them the other way round, Cancel then confirm
  const buttons = el('div', 'dialog-buttons');
  buttons.append(ok, cancel);
  form.append(text('h2', 'dialog-title', title), text('p', 'dialog-message', message), ...body, buttons);
  dialog.append(form);
  document.body.append(dialog);

  const result = setup(ok, dialog);
  // clicking the dimmed backdrop (outside the panel) cancels, like pressing Escape
  // (the wood frame is part of the dialog too, so check where the click landed, not just its target)
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (e.target === dialog && outside) dialog.close('cancel');
  });
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      resolve(result());
      dialog.remove();
    });
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const node = el(tag, className);
  node.textContent = content;
  return node;
}
