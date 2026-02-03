# --- AI CLI wrappers: optional worktree + auto-branch + approval bypass -----
# Short commands:
#   cdx -> codex
#   cld -> claude
#   gmi -> gemini
#
# Behavior:
# - If NOT in a git repo:
#     -> run tool here
# - If in a git repo:
#     -> show git state (branch, clean)
#     -> prompt:
#          k = keep current (no worktree)
#          w = create + checkout new worktree (prompts for branch name)
#          s = stop

# -------- config ------------------------------------------------------------
: "${AI_WORKTREE_ROOT:=../worktrees}"
: "${AI_CLAUDE_FLAGS:=}"
: "${AI_GEMINI_FLAGS:=}"
: "${AI_CODEX_FLAGS:=}"

# -------- color + logging ---------------------------------------------------
_ai_is_tty() { [[ -t 2 ]]; }

_ai_c_reset=$'\033[0m'
_ai_c_dim=$'\033[2m'
_ai_c_red=$'\033[31m'
_ai_c_green=$'\033[32m'
_ai_c_yellow=$'\033[33m'
_ai_c_blue=$'\033[34m'
_ai_c_magenta=$'\033[35m'
_ai_c_cyan=$'\033[36m'
_ai_c_bold=$'\033[1m'

_ai_color() {
  local c="$1"; shift
  if _ai_is_tty; then printf '%s%s%s' "$c" "$*" "$_ai_c_reset"
  else printf '%s' "$*"
  fi
}

_ai_log()   { printf '%s\n' "$(_ai_color "$_ai_c_dim"    "•") $*" >&2; }
_ai_info()  { printf '%s\n' "$(_ai_color "$_ai_c_cyan"   "→") $*" >&2; }
_ai_ok()    { printf '%s\n' "$(_ai_color "$_ai_c_green"  "✓") $*" >&2; }
_ai_warn()  { printf '%s\n' "$(_ai_color "$_ai_c_yellow" "!") $*" >&2; }
_ai_err()   { printf '%s\n' "$(_ai_color "$_ai_c_red"    "✗") $*" >&2; }

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

  _ai_info "Creating a new branch + worktree"
  _ai_log  "Suggested branch: $(_ai_color "$_ai_c_magenta" "$suggested")"
  read -r -p "Branch name (enter to accept): " name >&2
  [[ -z "$name" ]] && name="$suggested"

  git check-ref-format --branch "$name" >/dev/null 2>&1 || {
    _ai_err "Invalid branch name: $name"
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

_ai_create_worktree_and_run() {
  # args: tool base_ref ...tool_args
  local tool="$1"; shift
  local base_ref="$1"; shift

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

  _ai_info "Creating worktree…"
  _ai_log  "base   : $(_ai_color "$_ai_c_magenta" "$base_ref")"
  _ai_log  "branch : $(_ai_color "$_ai_c_magenta" "$new_branch")"
  _ai_log  "dir    : $(_ai_color "$_ai_c_magenta" "$wt_dir")"

  git worktree add -b "$new_branch" "$wt_dir" "$base_ref" || return $?

  _ai_ok "Worktree created"
  _ai_info "Running $(_ai_color "$_ai_c_bold" "$tool") inside worktree"
  ( cd "$wt_dir" && command "$tool" "$@" )
}

# -------- tool resolution & flags ------------------------------------------
_ai_resolve_tool() {
  case "$1" in
    cdx) printf '%s' codex ;;
    cld) printf '%s' claude ;;
    gmi) printf '%s' gemini ;;
    codex|claude|gemini) printf '%s' "$1" ;;
    *) printf '%s' "$1" ;;
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
_ai_run_with_optional_worktree() {
  local tool="$1"; shift

  if ! _ai_in_git_repo; then
    _ai_warn "Not in a git repo; running $(_ai_color "$_ai_c_bold" "$tool") here."
    command "$tool" "$@"
    return $?
  fi

  local br clean
  br="$(_ai_git_branch)"
  clean=0
  _ai_git_is_clean && clean=1

  printf '%s\n' "$(_ai_color "$_ai_c_blue" "Git state:")" >&2
  printf '  %s %s\n' "$(_ai_color "$_ai_c_dim" "branch:")" "$(_ai_color "$_ai_c_magenta" "${br:-"(detached)"}")" >&2
  printf '  %s %s\n' "$(_ai_color "$_ai_c_dim" "clean :")"  "$([[ $clean -eq 1 ]] && _ai_color "$_ai_c_green" yes || _ai_color "$_ai_c_yellow" no)" >&2

  local ans
  read -r -p "Choose: [k=keep current, w=create+checkout worktree, s=stop]: " ans

  if [[ "$ans" =~ ^[Ss]$ ]]; then
    _ai_warn "Stopped."
    return 1
  fi

  if [[ "$ans" =~ ^[Ww]$ ]]; then
    local base_ref
    # If detached, base on HEAD; otherwise base on current branch.
    base_ref="${br:-HEAD}"

    if (( ! clean )); then
      _ai_warn "Working tree is dirty; worktree will NOT include uncommitted changes."
    fi

    _ai_create_worktree_and_run "$tool" "$base_ref" "$@"
    return $?
  fi

  [[ "$ans" =~ ^[Kk]$ ]] || return 1

  _ai_info "Running $(_ai_color "$_ai_c_bold" "$tool") on current worktree (no new worktree)."
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

  _ai_run_with_optional_worktree "$tool" "${flags[@]}" "$@"
}

# -------- commands ----------------------------------------------------------
cdx() { _ai_run_with_default_flags cdx "$@"; }
cld() { _ai_run_with_default_flags cld "$@"; }
gmi() { _ai_run_with_default_flags gmi "$@"; }

# optional: keep long names (and keep bypass flags behavior here)
codex()  { _ai_run_with_default_flags codex  "$@" --full-auto; }
claude() { _ai_run_with_default_flags claude "$@" --permission-mode bypassPermissions; }
gemini() { _ai_run_with_default_flags gemini "$@" -y -s; }
# ---------------------------------------------------------------------------
