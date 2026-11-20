// Saltline City — localStorage save.
// Persists money, story progress and lifetime stats between visits.
// Everything is defensive: a corrupt or missing save just starts fresh.

const KEY = 'saltline-city-save-v1';

export const defaultSave = () => ({
  money: 120,
  missionIndex: 0,        // next story mission to offer (0..5, 5 = story done)
  totalEarned: 0,
  carsStolen: 0,
  timesBusted: 0,
  timesWasted: 0,
  bestStars: 0,           // highest wanted level ever reached
  finishedStory: false,
});

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    return { ...defaultSave(), ...parsed };
  } catch {
    return defaultSave();
  }
}

export function storeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Private mode / quota: the game simply runs unsaved.
  }
}

export function wipeSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// The headline score the start screen brags about.
export function scoreOf(save) {
  return save.totalEarned + save.missionIndex * 500 + save.carsStolen * 25;
}
