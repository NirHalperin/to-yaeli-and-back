# איך להעלות את האתר ל-Netlify

## למה לא עובד הגרירה (drag-and-drop)?

הגרסה החדשה כוללת **Netlify Functions** (backend לשמירת הסימניות) ו-**@netlify/blobs** (אחסון שמות). הגרירה של התיקייה לא תומכת בזה — חייבים לפרוס דרך ה-CLI **פעם אחת**, ואחרי זה אפשר להמשיך לפרוס בפקודה אחת.

---

## התקנה חד-פעמית

פתח Terminal (Spotlight → "Terminal") וריץ:

```bash
# 1. התקן את Netlify CLI (פעם אחת בחיים)
npm install -g netlify-cli

# 2. היכנס לחשבון Netlify שלך
netlify login
```

זה יפתח דפדפן, תאשר, וסיימת.

---

## פריסה ראשונה (one-time linking)

```bash
cd ~/Desktop/"Ad Yaeli and Back"/netlify-deploy

# התקנת התלות (מעט מגה — רק פעם ראשונה)
npm install

# קישור התיקייה הזו לאתר הקיים שלך ב-Netlify
netlify link
```

ב-`netlify link` יציע לך:
- **"Use current git remote..."** → בחר **"Search by full or partial site name"**
- הקלד את שם האתר (`ad-yaeli`, `yaelispace`, או איך שקראת לו)
- בחר אותו מהרשימה

---

## פריסה לפרודקשן

```bash
netlify deploy --prod
```

זהו. האתר כולל עכשיו:
- כל הפרקים
- feedback widget (אוהב / משפר / איפוס)
- bookmark chip בצד שמאל למעלה עם 20 אייקונים + שמות ייחודיים

---

## פריסות עתידיות

אחרי הקישור הראשוני, כל פעם שתרצה להעלות עדכון:

```bash
cd ~/Desktop/"Ad Yaeli and Back"/netlify-deploy
netlify deploy --prod
```

פקודה אחת. זה הכל.

---

## בדיקה מקומית לפני פרודקשן (אופציונלי)

```bash
cd ~/Desktop/"Ad Yaeli and Back"/netlify-deploy
netlify dev
```

פותח סביבה מקומית עם ה-Functions פעילים ב-`http://localhost:8888`.

---

## פתרון בעיות

- **"command not found: netlify"** — הרצת `npm install -g netlify-cli` הצליחה? נסה לסגור ולפתוח מחדש את הטרמינל.
- **"Site not found"** ב-`netlify link` — ודא שהאתר קיים בחשבון שלך ב-[app.netlify.com](https://app.netlify.com).
- **הסימנייה לא נשמרת בין מכשירים** — וודא שה-Function פעיל: גש ל-`https://[your-site].netlify.app/api/bookmark?name=test` — אמור להחזיר JSON (גם אם "not_found", זה תקין — אומר שה-Function רץ).
