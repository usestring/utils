# --- AI CLI wrappers: worktree-first + auto-branch + approval bypass ---------
# Short commands:
#   cdx -> codex
#   cld -> claude
#   gmi -> gemini
#
# Behavior:
# - If in git repo AND on main AND clean:
#     -> prompt for branch name
#     -> create branch + git worktree (no checkout switch)
#     -> run tool inside worktree
# - If not on main:
#     -> prompt: y = continue, m = checkout main, N = abort
# - If on main but dirty:
#     -> prompt to continue anyway
#
# Default approval-bypass flags are injected per tool via env vars:
#   AI_CLAUDE_FLAGS, AI_GEMINI_FLAGS, AI_CODEX_FLAGS
# ---------------------------------------------------------------------------

# -------- config ------------------------------------------------------------
: "${AI_WORKTREE_ROOT:=.ai-worktrees}"
: "${AI_CLAUDE_FLAGS:=}"
: "${AI_GEMINI_FLAGS:=}"
: "${AI_CODEX_FLAGS:=}"

# -------- git helpers -------------------------------------------------------
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

# -------- misc helpers ------------------------------------------------------
_ai_slug_from_args() {
  local s="$*"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//')"
  printf '%s' "${s:0:40}"
}

_ai_prompt_branch_name() {
  local suggested="$1"
  local name

  echo "Creating a new branch (on main + clean)." >&2
  echo "Suggested: $suggested" >&2
  read -r -p "Branch name (enter to accept): " name >&2
  [[ -z "$name" ]] && name="$suggested"

  git check-ref-format --branch "$name" >/dev/null 2>&1 || {
    echo "Invalid branch name: $name" >&2
    return 1
  }

  printf '%s' "$name"
}

_ai_worktree_dir_for_branch() {
  printf '%s' "$1" | tr '/:' '__'
}

_ai_next_free_dir() {
  local base="$1"
  local dir="$base"
  local i=1
  while [[ -e "$dir" ]]; do
    dir="${base}-${i}"
    i=$((i+1))
  done
  printf '%s' "$dir"
}

# -------- tool resolution & flags ------------------------------------------
_ai_resolve_tool() {
  case "$1" in
    cdx) printf '%s' codex ;;
    cld) printf '%s' claude ;;
    gmi) printf '%s' gemini ;;
    *)   printf '%s' "$1" ;;
  esac
}

_ai_tool_flags() {
  case "$1" in
    claude) printf '%s' "$AI_CLAUDE_FLAGS" ;;
    gemini) printf '%s' "$AI_GEMINI_FLAGS" ;;
    codex)  printf '%s' "$AI_CODEX_FLAGS" ;;
    *)      printf '%s' "" ;;
  esac
}

# -------- core runner -------------------------------------------------------
_ai_run_with_branching() {
  local tool="$1"; shift

  if ! _ai_in_git_repo; then
    command "$tool" "$@"
    return $?
  fi

  local br clean
  br="$(_ai_git_branch)"
  clean=0
  _ai_git_is_clean && clean=1

  # main + clean -> worktree
  if [[ "$br" == "main" ]] && (( clean )); then
    local ts slug suggested new_branch wt_root wt_dir_base wt_dir

    ts="$(date +%Y%m%d-%H%M%S)"
    slug="$(_ai_slug_from_args "$@")"
    [[ -z "$slug" ]] && slug="prompt"
    suggested="ai/${tool}/${ts}-${slug}"

    new_branch="$(_ai_prompt_branch_name "$suggested")" || return $?

    wt_root="$AI_WORKTREE_ROOT"
    mkdir -p "$wt_root" || return $?

    wt_dir_base="${wt_root}/$(_ai_worktree_dir_for_branch "$new_branch")"
    wt_dir="$(_ai_next_free_dir "$wt_dir_base")"

    git worktree add -b "$new_branch" "$wt_dir" main || return $?

    echo "→ worktree: $wt_dir" >&2
    echo "→ branch  : $new_branch" >&2

    ( cd "$wt_dir" && command "$tool" "$@" )
    return $?
  fi

  # other states
  echo "Git state:"
  echo "  branch: ${br:-"(detached)"}"
  echo "  clean : $([[ $clean -eq 1 ]] && echo yes || echo no)"

  local ans
  if [[ "$br" != "main" ]]; then
    read -r -p "Run '$tool' here? [y=continue, m=checkout main, N=abort]: " ans
    if [[ "$ans" =~ ^[Mm]$ ]]; then
      git checkout main || return $?
      _ai_run_with_branching "$tool" "$@"
      return $?
    fi
    [[ "$ans" =~ ^[Yy]$ ]] || return 1
  else
    read -r -p "Continue running '$tool' anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || return 1
  fi

  command "$tool" "$@"
}

# -------- default flags wrapper --------------------------------------------
_ai_run_with_default_flags() {
  local short="$1"; shift
  local tool flags_str
  local -a flags=()

  tool="$(_ai_resolve_tool "$short")"
  flags_str="$(_ai_tool_flags "$tool")"

  [[ -n "$flags_str" ]] && read -r -a flags <<<"$flags_str"

  _ai_run_with_branching "$tool" "${flags[@]}" "$@"
}

# -------- commands ----------------------------------------------------------
cdx() { _ai_run_with_default_flags cdx "$@"; }
cld() { _ai_run_with_default_flags cld "$@"; }
gmi() { _ai_run_with_default_flags gmi "$@"; }

# optional: keep long names
codex()  { _ai_run_with_default_flags codex  "$@"; }
claude() { _ai_run_with_default_flags claude "$@"; }
gemini() { _ai_run_with_default_flags gemini "$@"; }
# ---------------------------------------------------------------------------

