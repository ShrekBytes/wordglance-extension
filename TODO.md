## Features

- [x] Increase cache size to 500
- [x] Smart tooltip positioning to prevent screen edge cutoff
- [x] Improved mobile detection and browser compatibility
- [x] Performance optimizations with DOM selector caching
- [ ] Remove caches on browser startup

## Bug Fixes

- [x] Do not reset word learned count on cache clean up
- [x] Fix languages: not changing back to the initial language on popup open unless closing popup
- [x] Fix race conditions in tooltip repositioning
- [x] Fix memory leaks from event listeners
- [x] Fix character truncation issues
- [x] Consistent error handling and storage operations

## Removals

- [x] Remove translation count and definition count functionality
- [x] Keep only usage count
- [x] Remove dead code and unused constants
- [x] Eliminate code duplication across files

## Code Quality Improvements

- [x] Remove duplicate constants and utility functions
- [x] Optimize performance with cached DOM selectors
- [x] Improve mobile device detection
- [x] Add browser compatibility fallbacks
- [x] Standardize message passing between scripts
- [x] Clean up event listeners to prevent memory leaks
