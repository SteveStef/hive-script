import { LESSONS, TOPICS } from '../tutorial/lessons';
import { api, type Mode } from './api';
import { menuArt, TitleMeadow } from './title';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const layer = $('screen-layer');
const auth = $('auth-screen');
const authForm = $<HTMLFormElement>('auth-form');
const menu = $('menu-screen');
const tutorial = $('tutorial-screen');
const meadow = new TitleMeadow($<HTMLCanvasElement>('title-meadow'));
const art = menuArt();
$<HTMLImageElement>('art-single').src = art.single;
$<HTMLImageElement>('art-multi').src = art.multi;
$<HTMLImageElement>('art-tutorial').src = art.tutorial;

/** Shows one title page in place of the game, or the game (null). */
function show(panel: HTMLElement | null): void {
  layer.hidden = panel === null;
  auth.hidden = panel !== auth;
  menu.hidden = panel !== menu;
  tutorial.hidden = panel !== tutorial;
  document.body.classList.toggle('on-title', panel !== null);
  if (panel) meadow.start();
  else meadow.stop();
}

/** Shows sign-in until someone logs in or creates an account; resolves with their username. */
export function signIn(): Promise<string> {
  show(auth);
  const username = $<HTMLInputElement>('auth-username');
  const password = $<HTMLInputElement>('auth-password');
  const problem = $('auth-problem');
  problem.textContent = '';
  password.value = '';
  setTimeout(() => (username.value ? password : username).focus());
  return new Promise(resolve => {
    const submit = async (e: SubmitEvent) => {
      e.preventDefault();
      const signup = (e.submitter as HTMLButtonElement | null)?.value === 'signup';
      const name = username.value.trim().toLowerCase();
      if (!name || !password.value) {
        problem.textContent = 'Enter a username and a password.';
        return;
      }
      problem.textContent = signup ? 'Creating your account…' : 'Logging in…';
      try {
        const res = signup ? await api.signup(name, password.value) : await api.login(name, password.value);
        authForm.removeEventListener('submit', submit);
        password.value = '';
        resolve(res.username);
      } catch (err) {
        problem.textContent = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      }
    };
    authForm.addEventListener('submit', submit);
  });
}

/** Shows the main menu; resolves with what the player picked. */
export function mainMenu(username: string): Promise<Mode | 'tutorial' | 'logout'> {
  show(menu);
  $('menu-who').textContent = `Signed in as ${username}`;
  setTimeout(() => $('menu-single').focus());
  return new Promise(resolve => {
    const pick = (choice: Mode | 'tutorial' | 'logout') => () => {
      for (const [id, fn] of handlers) $(id).removeEventListener('click', fn);
      resolve(choice);
    };
    const handlers: [string, () => void][] = [
      ['menu-single', pick('single')], ['menu-multi', pick('multi')], ['menu-tutorial', pick('tutorial')], ['menu-logout', pick('logout')],
    ];
    for (const [id, fn] of handlers) $(id).addEventListener('click', fn);
  });
}

/**
 * The tutorial's lesson list, grouped by topic, with a checkmark on each finished lesson.
 * Resolves with the lesson picked, or null for back to the menu.
 */
export function lessonList(done: Set<string>): Promise<string | null> {
  show(tutorial);
  $('lesson-progress').textContent = done.size
    ? `${done.size} of ${LESSONS.length} lessons done. Open any lesson, in any order.`
    : `${LESSONS.length} short lessons, each with a goal the game checks. Open any one, in any order.`;
  const groups = TOPICS.map(topic => {
    const group = document.createElement('section');
    group.className = 'lesson-group';
    const h = document.createElement('h3');
    h.textContent = topic;
    group.append(h);
    for (const lesson of LESSONS.filter(l => l.topic === topic)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = done.has(lesson.id) ? 'lesson-pick done' : 'lesson-pick';
      b.dataset.lesson = lesson.id;
      const n = document.createElement('span');
      n.className = 'lesson-n';
      n.textContent = done.has(lesson.id) ? '✓' : String(LESSONS.indexOf(lesson) + 1);
      b.append(n, document.createTextNode(lesson.title));
      if (done.has(lesson.id)) b.title = 'Done';
      group.append(b);
    }
    return group;
  });
  $('lesson-groups').replaceChildren(...groups);
  const first = LESSONS.find(l => !done.has(l.id)) ?? LESSONS[0];
  setTimeout(() => tutorial.querySelector<HTMLElement>(`[data-lesson="${first.id}"]`)?.focus());
  return new Promise(resolve => {
    const pick = (e: Event) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-lesson]')?.dataset.lesson;
      const back = (e.target as HTMLElement).closest('#tutorial-back');
      if (!id && !back) return;
      tutorial.removeEventListener('click', pick);
      resolve(id ?? null);
    };
    tutorial.addEventListener('click', pick);
  });
}

/** Hides every screen, uncovering the game. */
export function closeScreens(): void {
  show(null);
}
