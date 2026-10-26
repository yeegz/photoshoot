// What's New, shipped inside the app so it reads offline. Newest first. Each
// release lists a few changes in plain words: a short lead, then a sentence.
// Keep in step with .github/RELEASE_NOTES.md when a release is cut.

export interface ChangelogEntry {
  version: string;
  date: string; // ISO date of the release
  items: { lead: string; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.5.1',
    date: '2026-10-26',
    items: [
      { lead: '27 new effects.', text: 'Film, Disposable, Soft Glam, Golden Hour, VHS, Sparkles, Hearts, Neon and more, plus Kaleidoscope and Edge Work from earlier Photo Booth releases.' },
      { lead: 'Masks that react.', text: 'Puppy, Kitty, Rainbow Mouth, Heart Eyes, Flower Crown and Seeing Stars respond when you open your mouth, raise your eyebrows or smile.' },
      { lead: 'Everyone in the picture.', text: 'Face effects now follow up to four people at once.' },
      { lead: 'Face effects fixed.', text: 'Bug Out, Chipmunk and the other face effects now land on your face instead of below it.' },
      { lead: 'Design your print.', text: 'Add a caption and the date in one of five fonts, three sizes, any alignment and six colours. Choose from five paper colours and rounded corners.' },
      { lead: 'Quieter branding.', text: 'The Photoshoot name is now a small mark in the corner of the print, and you can turn it off.' },
      { lead: 'Tall strips fit.', text: 'Viewing a classic strip now shows the whole print.' },
      { lead: 'Learn four photos.', text: 'A short tutorial appears the first time you choose four photos. The ? on the slot row shows it again.' },
      { lead: 'New sounds.', text: 'A mechanical shutter, a clean countdown beep and a little printer whir when your four photos are done.' },
      { lead: 'Automatic updates.', text: 'The Windows app now downloads updates by itself and installs them when you restart.' },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-26',
    items: [
      { lead: 'Camera stays on.', text: 'Viewing a photo and going back no longer leaves a black screen.' },
      { lead: 'Four photos, four countdowns.', text: 'Each photo gets its own countdown, and each can have its own effect.' },
      { lead: 'Choose your layout.', text: 'After four photos pick a grid, a strip, a row or one big photo over three.' },
      { lead: 'Movies play in place.', text: 'Opening a video plays it, and the tray shows its first frame.' },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-19',
    items: [
      { lead: 'Backgrounds that follow you.', text: 'Blur or replace the room behind you without stepping out of frame.' },
      { lead: 'Virtual camera.', text: 'Use Photoshoot in Discord, Zoom and Teams through OBS Studio on Windows.' },
      { lead: 'Update notices.', text: 'Photoshoot tells you when a newer version is available.' },
    ],
  },
];

/** Releases newer than `since` (all of them when `since` is empty), newest first. */
export function changesSince(since: string, compare: (a: string, b: string) => number): ChangelogEntry[] {
  if (!since) return CHANGELOG;
  return CHANGELOG.filter((e) => compare(e.version, since) > 0);
}
