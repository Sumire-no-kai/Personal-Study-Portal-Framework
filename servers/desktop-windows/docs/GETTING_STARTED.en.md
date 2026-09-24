# Note Portal: getting started

Note Portal turns a folder of Markdown (`.md`) files into a searchable reading site that refreshes when files change. You do not need a terminal or programming experience. The small app window shows the library status; your usual browser displays the documents. Note Portal does not generate AI content or upload your notes.

## First launch

Read the responsible-use notice, open the formatted full notice and scroll to its end before the agreement checkbox becomes available. Until you accept and complete the three-step, non-skippable introduction, the app cannot select a library or start its local service. You can reopen this detailed guide later. The control window defaults to the system's Chinese or English language; use the selector in its top-right corner or Settings to change it.

## Choose a library type

- **General:** Keep your existing folders. Ordinary `.md` files at the selected folder's top level or in its subfolders become documents.
- **Study:** Organise main notes by Semester → Unit → Week. Choose the folder containing `content/` and `inbox/`, not a folder inside `content/`.

You can select an existing folder or let the app create a new library. Check the recognition preview before confirming. Files that do not fit the Study structure appear in diagnostics; Note Portal never moves or renames them automatically.

### General example

```text
My Notes/                    ← select this folder
├── ideas.md
├── projects/
│   └── roadmap.md
└── reading/
    └── book-notes.md
```

To hide a General document from navigation, add `draft: true` in its frontmatter or put it in a hidden folder. When you create a note in the app, check the full destination `.md` path before confirming. An existing file will not be overwritten.

### Study example

```text
My Study Notes/              ← select this folder
├── content/
│   └── 2026-semester-2/
│       └── UNIT1001/
│           └── week-01/
│               └── week-01-notes.md
└── inbox/
    └── captured-note.md
```

The Week folder and main note must match: `week-01/week-01-notes.md`. For combined weeks, use a name such as `weeks-01-03/weeks-01-03-notes.md`. Other `.md` files beside a weekly main note are not mistaken for another Week note. Put unassigned Study documents in `inbox/`.

If you are migrating older notes, **copy** them to a temporary library first. Check that the page and relative image paths work before changing your originals.

## Everyday use

- **Open reader:** Open the local site in your default browser.
- **Refresh now:** Recheck the selected folder immediately.
- **Open folder:** Open the library in your file manager.
- **Create note / Create Week template:** Create only a new, previewed file. General mode can target an empty folder; the preview shows the destination relative to the library. Existing files are never overwritten.
- **Change library:** Preview another folder before switching.
- **Settings and terms:** Change the interface language and Windows reader accent colour, choose or clear a local PNG/JPEG/WebP logo (maximum 2 MiB), and reread the formatted responsible-use notice. Refresh an already open browser page after changing reader branding. No official institution logo is bundled.
- **Stop service / Start service:** Pause or resume local reading. Closing the small window does not quit the app; use **Quit** to stop it completely.

If you cannot find the taskbar icon after closing the window, launch Note Portal again. The existing process will reopen its control window without starting a second service. On Windows 11 you can also turn on Note Portal under **Settings → Personalization → Taskbar → Other system tray icons** to keep its icon visible in the taskbar corner.

Edit a `.md` file with your usual editor, or let an external tool update it. Save the file and Note Portal will refresh the browser view. Keep images beside the note, for example `topic/_assets/diagram.png`, and refer to them relatively as `![Diagram](_assets/diagram.png)`.

The local service listens on your own computer. A public internet deployment is not supported by this release. Follow the academic-integrity, copyright, privacy and confidentiality rules that apply to your materials.

## If a document is missing

First check the selected library type. In Study, verify all four path parts and the matching Week filename. Then press **Refresh now** and read the diagnostic path and suggestion. The app does not silently repair source files.

## If local settings cannot be loaded

This does not mean your notes are damaged. Try **Restore previous settings** first.
If no valid backup is available, choose **Back up and reset settings**, review the
confirmation, and set up the app again. The damaged settings are preserved for
inspection; source-library notes are not deleted or rewritten. If a selected
logo is missing or damaged, the app uses its text mark until you replace or
clear the logo in Settings.
