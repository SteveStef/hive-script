import { LESSONS, type Lesson } from './lessons';

export interface PanelActions {
  showMe(): void;
  restore(): void;
  reset(): void;
  next(): void;
}

/**
 * The lesson panel under the meadow: what to know and do, the goals with live checkmarks,
 * hints one at a time, and the "Lesson done" box once every goal is met.
 */
export class LessonPanel {
  private lesson: Lesson | null = null;
  private hintsShown = 0;
  private shownGoals = '';

  constructor(
    private readonly el: HTMLElement,
    actions: PanelActions,
  ) {
    el.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'hint') this.hint();
      else if (act === 'show') actions.showMe();
      else if (act === 'restore') actions.restore();
      else if (act === 'reset') actions.reset();
      else if (act === 'next') actions.next();
    });
  }

  /** Lays out a lesson: its intro and goals, no hints yet. */
  open(lesson: Lesson): void {
    this.lesson = lesson;
    this.hintsShown = 0;
    this.shownGoals = '';
    const n = LESSONS.indexOf(lesson) + 1;
    const last = n === LESSONS.length;
    this.el.innerHTML = `
      <div class="lesson-head">
        <span class="lesson-topic">${lesson.topic} · lesson ${n} of ${LESSONS.length}</span>
        <h2 class="lesson-title"></h2>
      </div>
      <div class="lesson-intro">${lesson.intro}</div>
      <div class="lesson-goals-head">Goal${lesson.goals.length > 1 ? 's' : ''}</div>
      <ul class="lesson-goals"></ul>
      <div class="lesson-done" hidden>
        <b>Lesson done!</b>
        <p class="lesson-recap"></p>
        <p class="lesson-keep">Your bees keep going: change the code and Run again, or move on.</p>
        <button class="pbtn" type="button" data-act="next">${last ? 'Back to the lessons' : 'Next lesson'}</button>
      </div>
      <ol class="lesson-hints"></ol>
      <div class="lesson-actions">
        <button class="pbtn quiet" type="button" data-act="hint">Hint</button>
        <button class="pbtn quiet" type="button" data-act="show" title="Put a working solution in the editor">Show me</button>
        <button class="pbtn quiet" type="button" data-act="restore" hidden title="Put your own code back">Bring back my code</button>
        <button class="pbtn quiet" type="button" data-act="reset" title="Go back to the lesson's starting code">Start over</button>
      </div>`;
    this.q('.lesson-title').textContent = lesson.title;
    this.q('.lesson-recap').textContent = lesson.recap;
    this.goals(lesson.goals.map(() => false));
  }

  /** Ticks off the goals met so far, and shows "Lesson done" when they all are. */
  goals(met: boolean[]): void {
    const key = met.join();
    if (!this.lesson || key === this.shownGoals) return;
    this.shownGoals = key;
    const items = this.lesson.goals.map((g, i) => {
      const li = document.createElement('li');
      li.className = met[i] ? 'met' : '';
      li.textContent = g.text;
      return li;
    });
    this.q('.lesson-goals').replaceChildren(...items);
    const done = this.q('.lesson-done');
    const was = !done.hidden;
    done.hidden = !met.every(Boolean);
    if (!done.hidden && !was) done.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Whether "Bring back my code" is offered (after Show me replaced the player's code). */
  canRestore(on: boolean): void {
    this.q('[data-act="restore"]').hidden = !on;
  }

  private hint(): void {
    const hints = this.lesson?.hints ?? [];
    if (this.hintsShown >= hints.length) return;
    const li = document.createElement('li');
    li.textContent = hints[this.hintsShown++];
    this.q('.lesson-hints').append(li);
    const button = this.q<HTMLButtonElement>('[data-act="hint"]');
    button.disabled = this.hintsShown >= hints.length;
    button.textContent = button.disabled ? 'No more hints' : 'Another hint';
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.el.querySelector<T>(selector)!;
  }
}
