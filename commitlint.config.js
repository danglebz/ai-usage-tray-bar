// @ts-check

// Conventional Commits, checked at commit time by .husky/commit-msg.
//
// The format is not only a convention here: release-please reads these subjects to decide
// the next version and copies them into CHANGELOG.md as they are. A malformed one does not
// fail loudly - it quietly lands in the wrong release, or in none at all.
export default {
  extends: ["@commitlint/config-conventional"],
};
