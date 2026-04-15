
# Session Context

**Repository:** fluxaos
**Git Forge:** Forgejo at git.jdp21.com (NOT GitHub)

## Critical Constraints

- ❌ Never use `gh` or `tea` commands (will be denied by permissions)
- ❌ Never publish directly to `main` (use PR flow; pre-push blocks direct `main` pushes)
- 📋 Use TodoWrite for multi-step tasks to track progress
- 📖 Reference `.claude/CONSOLIDATED_REFERENCE.md` for workflows

## Project Capabilities

- **Webapp:** false
- **Service Name:** 
- **Has Logs:** false
- **Browser Tests:** false

## Browser Testing

To check if browser testing is available for this project:

```bash
python -c "from fluxaos.browser import BROWSER_AVAILABLE; print('Browser testing:', 'AVAILABLE' if BROWSER_AVAILABLE else 'not configured')" 2>/dev/null || echo "Browser testing: not configured"
```

If browser testing is available, use `/verify-webapp` for webapp verification during `/finish`.

**Session context loaded. Ready to work!**
