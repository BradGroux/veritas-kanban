# Settings field alignment (#1404)

The shared NumberRow placed a unit beside its input, shifting unit-bearing fields 48px left. Fixed Select widths also defeated the shared control column. Numeric units now use the input's suffix formatter, while direct input/select controls fill the row column. Board and Tasks selectors no longer override the common size.

Browser regression failed on the old source with a 48px edge difference, then passed with equal input edges, widths, and heights at 1180px in light/dark and 16/20px text. Compact 620px widths also match. The priority dropdown opens correctly. Inspected browser captures show the aligned fields. Sixteen focused tests pass, including numeric unit parsing, blur/clamping, decimal values, and retained spinner controls. Web typecheck and changed-file lint pass.

Native packaged acceptance remains pending. Long-unit clearance and the remaining Settings field families need rendered acceptance before this issue is complete. The installed app has not been replaced. Maintained screenshots/GIFs will be refreshed after final UI acceptance, not from these intermediate captures.
