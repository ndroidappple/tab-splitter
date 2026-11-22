# Working on Splitty

## UX principle: ask about the exception, then offer the action

When the app needs input that only matters sometimes, don't ask everyone a question up front, and
don't claim a state the app can't actually know. Put the common case on the screen, then add one quiet
line that names the exception as a question, followed by a verb to act on it.

- Good: "Tip not included? **Add one**". This doesn't claim anything, only the people it applies to
  act on it, and everyone else carries on.
- Avoid: a required Yes/No question ("Is the tip already in the total?") for something most people
  never need to change.
- Avoid: stating a guess as fact ("Tip included.") when the app can't know it.
- When the app *does* know, or makes a confident guess, say what it did and give a way to undo it:
  "Looks pre-tip, so I added one. **Remove**".

Wording that goes with it:
- Status text describes the state (a noun or adjective). Buttons and links describe the action (a verb).
- Never use an icon alone where it could mean either the current state or the one you'd switch to (the
  sun/moon theme toggle problem). Label it, or use a real switch where position shows the state.
- Keep the exception's controls small and secondary until someone opts in, so they don't compete
  with the main action on the screen.
