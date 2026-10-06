# Feature parity with Microsoft Chat 2.5 beta-1

Every feature of `v2.5-beta-1-modern` (menus, say bar, rules, panel engine),
and what became of it here. Source of truth for the original: `chat.rc`
(menus and dialogs), `rules.h` (automation), `panel.cpp`, `avatar.cpp`,
`bodycam.cpp`, `textpose.cpp`.

Legend: ✅ done in phase 1 · 🕐 phase 2 (live chat) · 🔶 done differently or in
part · ➖ does not exist on the web (and why)

## Comic engine

| Original | Here | |
|---|---|---|
| Entries become panels; a new panel starts when the speaker is already in it, at 5 balloons, when the cast would exceed 5, when the text will not fit, or for an action box (`CUnitPanelPage::AddLine`) | `shared/layout.js` | ✅ |
| Long messages split across panels (`ForceFitBalloon`) | `splitMessage`, 190 characters per balloon | ✅ |
| Greedy cast ordering with a facing penalty, talk-to adjacency, and per-character memory of last direction and neighbours (`OrderAvatars`, `EvalPlacement`, `EvalPair`, `UpdateHistoresis`) | `orderCast` | ✅ |
| Addressed characters join the panel in a neutral pose (`AddTalkTos`) | `to` / `@Name` / `/to` | ✅ |
| Characters scaled to a common height, shrunk if the cast is too wide; **camera zoom** on small casts with the backdrop cropped about the fixed point; the opening panel is an "establishing shot" without zoom (`LayoutAvatars`, `AdjustArtToCoord`, `Establishing`) | `shared/scene.js` | ✅ |
| Two-part (head + torso) and one-piece characters, mask/aura drawing, flip (`CBodyDouble`/`CBodySingle::DrawBody`, `GetBodyBox`) | `tools/convert-art.mjs`, `scene.js`, `draw.js` | ✅ |
| Pose chosen by nearest emotion angle then intensity, cycling equally good torsos (`GetBodyFromEmotion`) | `emotion.js` | ✅ |
| Gestures: wave, point at other, point at self (29 of 35 characters have them), double point (1), shrug (5) | torso records `1001…1005`, chosen by the text rules; characters without a gesture keep a neutral body | ✅ |
| Speech, thought (cloud + bubble trail), whisper (dashed), action (narration box) balloons | `render/draw.js` | ✅ send whisper 🕐 |
| Balloon placement with route regions so tails do not cross (`LayoutBalloon`, `AdjustRouteRgns`) | tail corridors; simpler, deterministic | 🔶 |
| Random panel layout seeded per panel so a redraw never changes | seeded PRNG (`prng`, `hash`) | ✅ |
| Backdrops (`.bgb`), per-panel, shared by the room | 9 converted; a scene change starts a panel | ✅ |
| White "aura" around characters | halo layer, switchable in Options | ✅ |
| Panels-per-row, auto-fit on resize | View menu, Options, automatic | ✅ |
| Names under characters | name tags, switchable | ✅ |
| Rich text in balloons: bold, italic, underline, fixed pitch, symbol font, colour | BBCode + toolbar; Symbol font mapped to Greek letters | ✅ |
| Hyperlinks | linked in the plain-text view | 🔶 not clickable inside balloons |
| Comic Sans balloon font | bundled Comic Neue (OFL), identical metrics on every device | 🔶 |

## Emotion wheel (BodyCam)

| Original | Here | |
|---|---|---|
| Eight emotions around a wheel, intensity by distance, neutral dead zone in the middle | same geometry, same convention (happy east, bored north, sad west, shout south) | ✅ |
| The original pixel-art face icons | converted from `res/fc_*_l.bmp` | ✅ |
| Preview of your character | live preview | ✅ |
| Freeze / Unfreeze | Freeze checkbox | ✅ |
| Send Expression (react without words) | "Send expression"; `expression` entries | ✅ |
| **Automatic expressions from text** (all-caps and `!!!` shout, `ROTFL/LOL/HEHE` laugh, `:)` happy, `:(` sad, `;)` coy, "Hi/Hello/Bye/Welcome/Howdy" wave, "I…" point at self, "You…" point at other) with the original priorities | `emotion.js` `DEFAULT_RULE_TEXT`, same strings | ✅ |
| Keyboard-only use of the wheel | emotion buttons + intensity slider | ✅ new |

## Menus

| Menu item | Here | |
|---|---|---|
| **File** New Connection | Sign in / Create an account | ✅ |
| Open, Close, Save, Save As | Save comic as picture, transcript as text, JSON backup | 🔶 |
| Create Shortcut | — | ➖ browsers bookmark |
| Print, Print Setup | Print (comic sheet via the browser) | ✅ / ➖ setup |
| Exit | Sign out | ✅ |
| **Edit** Undo, Cut, Copy, Paste, Clear, Select All | work in the say box | ✅ |
| Clear History | hides history for you; Show all history restores | ✅ |
| **View** Toolbar (main, member, text), Status bar | Toolbar, Member list, Status bar toggles | ✅ |
| Tab bar | — | 🕐 room tabs |
| Status Window (server messages) | — | ➖ no server console |
| Comic Strip / Plain Text | both; Plain Text is also the accessible view | ✅ |
| Member List: List / Icon | both | ✅ |
| Message of the Day | banner + dialog, owner-editable | ✅ |
| Turn Off Sounds | synthesised sounds, switchable | ✅ |
| Logon Notifications | favourites sign → toast + chime; mentions | 🔶 real logons 🕐 |
| **Macros** Define Macro | macro editor; run with `/name` | ✅ |
| Automation | rule sets (below) | ✅ phase-1 subset |
| Options | Options dialog | ✅ |
| **Format** Color, Bold, Italic, Underline, Fixed Pitch, Symbol | all six | ✅ |
| **Room** Enter, Leave, Create, Room List | Room list shows the one room | 🕐 |
| Room Properties: topic, moderated, private, hidden, invite-only, max users, no whispers, password | name, topic, MOTD, default backdrop, scene changes | 🔶 rest 🕐 |
| Connect / Disconnect | — | ➖ the browser is always "connected" |
| **Member** User List | searchable list + profiles | ✅ |
| Invite | — | 🕐 |
| Away from Keyboard | — | 🕐 |
| Get Profile | profile dialog | ✅ |
| Get Identity | — | ➖ no IRC identity; profile covers it |
| Whisper Box | — | 🕐 |
| Add to Notifications | favourites | ✅ |
| Ignore | per account, hides their entries from your strip | ✅ |
| Send E-mail | — | ➖ emails are not stored |
| Send File | — | 🕐 (R2) or ➖ |
| Visit Home Page | profile home page (http/https only) | ✅ |
| NetMeeting | — | ➖ obsolete |
| Version | About | ✅ |
| Lag Time | `/ping`, Member → Lag time | ✅ |
| Local Time | — | 🕐 needs presence |
| **Favorites** Add, Open | favourite members | ✅ rooms 🕐 |
| **Window** Cascade, Tile, Arrange Icons | — | ➖ browser tabs |
| **Help** topics, About | Help, Commands, About | ✅ |
| "Microsoft on the Web", Release Notes | — | ➖ |
| **Body context** Frozen, Send Expression | wheel | ✅ |
| **Host context** Kick | remove entries; ban | 🔶 |
| Ban / UnBan | owner can ban/unban, optionally remove entries | ✅ |
| Sync Backgrounds | Room properties → default backdrop for the strip | 🔶 |
| Host, Speaker, Spectator (moderated rooms) | owner role only | 🕐 |

## Say bar

| Original | Here | |
|---|---|---|
| Say, Think, Action | three buttons | ✅ |
| Whisper | — | 🕐 |
| Play Sound / Send Sound | local sounds only | 🔶 |
| Command history (Up/Down) | Up/Down recall | ✅ |
| `/` commands | `/me /think /say /to /macro /ignore /unignore /fav /unfav /profile /nick /ping /clear /help` | ✅ |

## Automation (Macros → Automation) — `rules.h`

The vocabulary is the original's: **11 events, 30 actions**, keyword
parameters (anyone / me / anyone but me / a member), and the "minimum delay"
exception. Items needing live rooms are listed but disabled.

| Events | |
|---|---|
| OnMessage (someone signs) | ✅ |
| OnJoin (a new member joins) | ✅ |
| OnNewHost, OnConnect, OnDisconnect, OnInvitation, OnKick, OnLeave, OnNewRoom, OnWhisper, OnWhisperInRoom | 🕐 |

| Actions (16 live now) | |
|---|---|
| Beep, PlaySound, HighlightMessage, DoNotDisplay, ReplaceMessage, NotifyDialog, Ignore, GetProfile, GetLagTime, ExecuteMacro, SendMessage, SendThought, SendAction, SendFileLine (a line from a macro), ActivateRuleSet, Ban (host) | ✅ |
| JoinRoom, LeaveRoom, Kick, MakeHost, Invite, Connect, Disconnect, SendWhisper, SendWhisperInRoom, WhisperFileLine, SendSound, GetIdentity, GetLocalTime, GetVersion | 🕐 |

Rules run in the browser while the page is open (as the original ran in the
client). Automatic posts are capped at one every 20 seconds, six per ten
minutes.

## Art

| Original | Here | |
|---|---|---|
| 25 + 10 characters and 7 + 2 backdrops from `comicart/` and `artpack1/` | all converted (35 characters, 9 backdrops) | ✅ |
| Downloading characters/backdrops from Microsoft's servers | — | ➖ the servers are gone; add art with the converter |
| `.avb` / `.bgb` / `.bmp` formats | `tools/avb.mjs` reads all of them | ✅ |

## Deliberately not carried over

IRC/IRCX/CB32 protocol, SSPI authentication, NetMeeting, OLE document-object
embedding in Internet Explorer, the registry, Shift-JIS conversion (everything
is UTF-8), Windows help (`.hlp`), DPI-awareness tricks. None applies to a web
page.

## Known approximations

1. **Panel grouping is measurement-free.** The original asks the balloon engine
   whether text fits; here a fixed line budget decides, so grouping is the same
   on every device and needs no fonts. If a panel's text still does not fit,
   the balloons shrink their font instead.
2. **Balloon placement is simpler** than the original's route-region solver, but
   deterministic and non-overlapping (see `scene.test.mjs`).
3. **No "first two panels" special case** (the original always gave the first
   two panels one speaker each).
4. **Sentence-start rules.** The original tested the start of the whole message
   for every sentence (an evident bug); here each sentence is tested at its own
   start.
5. **Torso cycling.** The original cycled through equally good poses using
   per-session state; here the starting point is a hash of the entry, so a
   history always renders identically.
