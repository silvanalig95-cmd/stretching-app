// A small starter shelf so the app is usable before you've searched anything.
//
// These came from web search results, NOT from the YouTube API, so channel names
// and lengths are best guesses (lengths come from the video titles). They are
// flagged `verified: false`; with an API key the app re-checks them on first run
// (fixing titles/lengths/channels and flagging any that no longer exist), and
// the embedded player corrects length/title when a video is opened.
// Everything else in your library is found live by the app itself.

export const STARTER_VERSION = 1;

// [id, title, channel ('' if unknown), minutes]
const ROWS = [
  ['X3-gKPNyrTA', 'Yoga For Neck, Shoulders, Upper Back - 10 Minute Yoga Quickie', 'Yoga With Adriene', 10],
  ['GffXQl3zvUI', 'Hip Mobility', 'Yoga With Adriene', 13],
  ['LNOucekw2co', 'Heart And Hips Practice', 'Yoga With Adriene', 26],
  ['JsE4csvlUfA', 'Yoga For Psoas', 'Yoga With Adriene', 20],
  ['J-05m7bboK0', 'Lower Back Love', 'Yoga With Adriene', 27],
  ['2xF_teT2_V0', 'Yoga For Low Back and Hamstrings', 'Yoga With Adriene', 30],
  ['7ZQr_Um3Wlk', 'Yoga For Tight Hamstrings & Lower Back', 'Yoga With Adriene', 10],
  ['V_ZLiTLCdXs', 'Quad Release - 15 minute Yoga Practice', 'Yoga With Adriene', 15],
  ['Yzm3fA2HhkQ', 'Yoga For Flexibility', 'Yoga With Adriene', 16],
  ['FQVQmT5_z3w', '10 min Upper Body Yoga Stretch - Beginner Yoga for Neck, Shoulders & Back', 'Yoga With Kassandra', 10],
  ['SEOy2n_uarc', '10 min Morning Yoga For Neck & Upper Back Relief', 'Yoga With Kassandra', 10],
  ['ekBwaykW7Jw', '15 min Upper Body Yoga Stretch - Yoga For Your Spine', 'Yoga With Kassandra', 15],
  ['p9gy8spCz7M', '10 min Morning Yoga For Your BACK', 'Yoga With Kassandra', 10],
  ['UpJVuyiCaRI', '25 min Morning Yoga for Tight & Sore Muscles', 'Yoga With Kassandra', 25],
  ['IBx-MhwtYJw', '10 min Morning Yoga Full Body Stretch', 'Yoga With Kassandra', 10],
  ['0csd0KboO44', '20 minute Deep Hip Yoga Stretches', 'Sarah Beth Yoga', 20],
  ['F0j0478kwCM', '20 minute Deep Stretch Yoga for HIP FLEXORS', 'Sarah Beth Yoga', 20],
  ['VXsYbc7Wu1U', '20 minute Deep Stretch Yoga For Low Back', 'Sarah Beth Yoga', 20],
  ['AHFtQFVlHz8', '20 minute Yoga for Posture & Flexibility', 'Sarah Beth Yoga', 20],
  ['NQLfyK9YgYM', '20 minute Bedtime Yoga Stretch IN BED for Legs & Hips', 'Sarah Beth Yoga', 20],
  ['d-Ur2Mm6bCs', '20 min DEEP STRETCHING Yoga for Flexibility: Hip Flexors, Quads, Hamstrings', '', 20],
  ['X7Nq35xkyd8', '30min. "Yin Yoga for Sleep" with Travis', 'Travis Eliot', 30],
  ['E9UKgwE6gAw', '30 minute "Upper Body Yin" yoga class with Travis for neck, shoulders, and chest.', 'Travis Eliot', 30],
  ['PNVwRc10rGw', '10 Minute Lower Back Pain Stretching Workout by Bob & Brad', 'Bob & Brad', 10],
  ['4snu7NxD4nM', '15 Min. Morning Stretch', 'Mady Morrison', 15],
  ['g_tea8ZNk5A', '15 Min. Full Body Stretch', 'Mady Morrison', 15],
  ['lAtFNsT--74', '15 Minutes to Freedom: Hip Stretch & Opening Routine', '', 15],
  ['FSDvlCYUDi0', '15 min Gentle Yoga Flow for TIGHT HIPS - Deep Hip Release', '', 15],
  ['zPzSkLHp9ws', 'Yoga for Calves and Shins - 10 Minute Yoga Stretches and Massage for Tight Lower Legs and Ankles', '', 10],
  ['daBUs8sRZ-Y', '10 Minute Yoga Stretch For Feet, Ankles & Calves / Yoga With Paige', 'Yoga With Paige', 10],
  ['uQohpNbzyUg', '10 min CALF STRETCHES for Flexibility (Easy Follow Along)', '', 10],
  ['9GiLEupJq40', '10 Min YOGA FOR FEET - Follow Along FOOT STRETCH for FOOT PAIN', '', 10],
  ['8vKw2t58vbg', 'Yoga for Sciatica & Piriformis Syndrome Stretches - 15 min Practice', '', 15],
  ['uS0R-q3wVvY', 'Yin Yoga for the Piriformis Muscle (Great for Sciatica & Piriformis Syndrome)', '', 15],
  ['_X_TEgk6rG4', '15 Min Yoga for Chest and Shoulders', '', 15],
  ['ufrzM7apn1o', '15 Minute Chest and Shoulder Mobility Workout', '', 15],
  ['iZIvBi0AJkc', 'Beginners Yoga Workout (15 min Core Strength) Day 5', '', 15],
  ['f0PhrZ93atw', 'Ab and Core Yoga Workout - 15 min Beginners Core Strength Sequence', '', 15],
  ['ClzZlHs4rlk', 'Yoga Workout for Glutes - 20 min Yoga Class For A Better Booty!', '', 20],
  ['kTsUee2I18Q', '20 Min Yoga for Glutes & Quads: Goddess, Bridge & a Slow Chair Hold', '', 20],
  ['n60Ub1_VoC4', '10 Minute Quad and Hip Flexor Mobility Routine (Follow Along)', '', 10],
  ['H4zJBCzWPz4', 'IT Band Stretches + Quick Yoga Flow for Your Hips (10-min) - Yoga Stretch for Runners', '', 10],
  ['qaFAcVnveCw', 'Wrist & Forearm Flow: Relief for Keyboard Hands', '', 4],
  ['yFkX7D7cOZ4', 'Yoga for Wrists and Forearms - 10 minute Somatics stretch class for relief from hand & arm pain', '', 10],
  ['Poz19E3V4mM', '15 Min Yoga Routine For Desk Workers', '', 15],
  ['hA6IfPbEkoc', '15 MIN Full Body Stretch Routine 🔥 Improve Flexibility & Mobility', '', 15],
];

export const STARTER_VIDEOS = ROWS.map(([id, title, channel, min]) => ({
  id, title, channel, durationSec: min * 60, durationApprox: true,
  views: null, likes: null, embeddable: true, verified: false, source: 'starter',
}));
