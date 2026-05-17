---
name: Workout Share Card
description: Strava-style 1080x1920 workout share image, html2canvas PNG export, dark/light/transparent themes
type: feature
---
- Trigger: シェアボタン on CustomerHome (latest workout) + each date card on CustomerTraining.
- Card: 1080x1920 (9:16). Built in `WorkoutShareCard.tsx` with inline styles for html2canvas reliability.
- Themes: dark (#0F0F0F), light (#FAFAF7), transparent. Accent #0ABAB5 (tiffany blue).
- Modal: `WorkoutShareModal.tsx`. html2canvas → PNG. Web Share API via navigator.share, fallback to download.
- Session = same workout_date grouped. PR = max weight that day >= prior max for same exercise (first record also counts).
- Volume metaphor in `lib/workoutShare.ts`: <1000kg 大型犬, <3000kg 軽自動車, <10000kg アフリカゾウ, else シロナガスクジラ.
- Total sessions = past non-cancelled bookings count.