# --- AI CLI wrappers: auto-branch + prompts (claude, gemini, codex) ----------
# Behavior:
# - If in a git repo AND on main AND working tree clean:
#     -> prompt for branch name (with suggested default)
#     -> create+checkout that branch
#     -> run the tool
# - Otherwise:
#     -> show git state and prompt to continue anyway

_ai_in_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

_ai_git_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

_ai_git_is_clean() {
  git diff --quiet --ignore-submodules -- &&
  git diff --cached --quiet --ignore-submodules --
}

_ai_slug_from_args() {
  local s="$*"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//')"
  printf '%s' "${s:0:40}"
}

_ai_prompt_branch_name() {
  local suggested="$1"
  local name

  echo "Creating a new branch (on main + clean)."
  echo "Suggested: $suggested"
  read -r -p "Branch name (enter to accept): " name
  [[ -z "$name" ]] && name="$suggested"

  git check-ref-format --branch "$name" >/dev/null 2>&1 || {
    echo "Invalid branch name: $name" >&2
    return 1
  }

  printf '%s' "$name"
}

_ai_run_with_branching() {
  local tool="$1"; shift

  if ! _ai_in_git_repo; then
    command "$tool" "$@"
    return $?
  fi

  local br clean
  br="$(_ai_git_branch)"
  clean=0
  if _ai_git_is_clean; then
    clean=1
  fi

  if [[ "$br" == "main" ]] && (( clean )); then
    local ts slug suggested new_branch
    ts="$(date +%Y%m%d-%H%M%S)"
    slug="$(_ai_slug_from_args "$@")"
    [[ -z "$slug" ]] && slug="prompt"
    suggested="ai/${tool}/${ts}-${slug}"

    new_branch="$(_ai_prompt_branch_name "$suggested")" || return $?
    git checkout -b "$new_branch" || return $?
    echo "→ created & switched to: $new_branch"
  else
    echo "Git state:"
    echo "  branch: ${br:-"(detached)"}"
    if (( clean )); then
      echo "  clean : yes"
    else
      echo "  clean : no"
    fi
    read -r -p "Continue running '$tool' anyway?y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || return 1
  fi

  command "$tool" "$@"
}

claude() { _ai_run_with_branching claude "$@"; }
gemini() { _ai_run_with_branching gemini "$@"; }
codex()  { _ai_run_with_branching codex  "$@"; }
# --------------------------------------------------------------------------- 

