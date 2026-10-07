# Tedious diagnostic formatter

This is a narrowly scoped replacement for Tedious's `sprintf-js` dependency.
The root npm override applies it only to Tedious. It removes the vulnerable
package affected by GHSA-hp3w-g68c-fv3c without downgrading or removing SQL Server
support.

The root `sprintf-js` dependency points to this local package, and the scoped
override reuses that dependency through npm's `$sprintf-js` reference.
Clean-install tests verify this resolution without relying on an existing
`node_modules` directory.

Tedious currently uses only `%s`, `%d`, and zero-padded hexadecimal formats
such as `%02X`, `%04X`, and `%08X`. This adapter supports those formats and
`%%`, caps field widths at 32, and leaves unsupported specifiers literal.
It does not implement floating-point precision, cache arbitrary format strings,
or allocate padding proportional to unchecked input.

The tests exercise Tedious's packet and login diagnostics, metadata errors,
hostile precision and width inputs, and every static format string used by
the installed Tedious release. A future driver change requiring additional
format specifiers must fail those compatibility tests rather than silently
alter diagnostics.

Remove this override when an upstream release removes or fixes `sprintf-js`.
