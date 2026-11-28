# PLAYBOOK.md

Every play design in the playbook, by group, with its one-line description and its tags. There are 107 offense designs and 40 defense designs.

The list here must match the design files, `data/plays/offense.json` and `data/plays/defense.json`. A test fails if they drift apart (packages/shared/test/playbook-data.test.ts, criterion A10), so change both together. The spec is docs/specs/m3-playbook-and-custom-routes.md.

## What a design is

- A design is a named play: a formation and a concept on offense, a package and a coverage preset on defense, plus one assignment for each of the eleven players. The assignments come from a small library, `data/plays/library.json`.
- Every design belongs to exactly one engine call (a formation and concept, or a preset). Each engine call has one design marked Default.
- The whole catalog is designed, by hand. Nothing in it comes from play data, and the names are generic football terms.
- Designs have no effect on results yet. Today the engine reads only the engine call. Design effects arrive in a later milestone of the spec (D).
- No group has more than six designs, so a group fits on one screen with Back.

## Tags

- depth (pass designs only): behind, short, intermediate or deep, where the first read is caught.
- timing: quick, standard or slow, how long the play takes to develop. The tag must be one the design's assignments allow, by the rows in `data/plays/config.json` (`timing`), which read the drop, the fake and the routes, never the concept alone.
- pressure (defense only): none, exchange (a lineman drops and another defender rushes in his place) or blitz.
- situations: when the design is a natural pick. Each tag has a designed definition in `data/plays/config.json`, written on the play caller's bin edges:
  - shortYardage: Three yards or fewer to go on a scrimmage down.
  - redZone: Snapping at or inside the opponent's 20.
  - goalLine: Snapping at or inside the opponent's 5, two-point tries included.
  - twoMinute: Two minutes or less left in the half on a scrimmage down.
  - longYardage: Eleven yards or more to go on a scrimmage down.
  - backedUp: Snapping at or inside the offense's own 10.
  - runClock: Ahead in the fourth quarter with five minutes or less to play.
- traits: what the design does, in the words of `data/plays/config.json` (`traits`). Tags and traits are browse keys and inputs for recommendations. On their own they change no result.

Left and right are always the offense's left and right. Situation tags on defense designs are written from the offense's side of the ball too.

## Offense

### Shotgun: Inside run

- **Inside Zone** (`shotgun.insideRun.insideZone`): The line steps to the right together and the back picks a crease between the guards. Tags: timing standard; situations runClock; traits zone. Default.
- **Draw** (`shotgun.insideRun.draw`): Everyone shows pass, then the back takes a late handoff up the middle. Tags: timing slow; situations longYardage, twoMinute; traits misdirection.
- **Power** (`shotgun.insideRun.power`): The left guard and tight end block down, the left tackle holds his man outside, and the back follows the pulling right guard between them. Tags: timing standard; situations shortYardage, redZone; traits gap.

### Shotgun: Outside run

- **Outside Zone** (`shotgun.outsideRun.outsideZone`): The line reaches to the left and the back stretches the run to the tight end's edge. Tags: timing standard; situations runClock; traits zone, perimeter. Default.
- **Sweep** (`shotgun.outsideRun.sweep`): Both guards pull to the right and the slot receiver cracks inside as the back sweeps around them. Tags: timing slow; situations none; traits gap, perimeter.
- **Counter** (`shotgun.outsideRun.counter`): The back steps right, then cuts back left off tackle behind a pulling guard and tackle. Tags: timing slow; situations none; traits gap, misdirection.

### Shotgun: QB sneak

- **Sneak** (`shotgun.qbSneak.sneak`): The quarterback takes the snap and pushes straight ahead behind the center. Tags: timing quick; situations shortYardage, goalLine; traits none. Default.

### Shotgun: Short

- **Slant Flat** (`shotgun.shortPass.slantFlat`): The left receiver slants inside while the tight end runs to the flat under him. Tags: depth short; timing quick; situations shortYardage, redZone, backedUp; traits quick. Default.
- **Stick** (`shotgun.shortPass.stick`): The tight end sits just past the sticks, the back runs to the flat beside him and the outside receiver clears deep. Tags: depth short; timing quick; situations shortYardage; traits quick, highLow.
- **Curl Flat** (`shotgun.shortPass.curlFlat`): Both outside receivers curl at 8 yards with a flat route under each of them. Tags: depth short; timing standard; situations none; traits highLow.
- **Mesh** (`shotgun.shortPass.mesh`): The tight end and the slot receiver cross shallow over the middle, rubbing off each other. Tags: depth short; timing standard; situations shortYardage, redZone; traits crossers, highLow.
- **Quick Outs** (`shotgun.shortPass.quickOuts`): Three receivers break to the sidelines at 5 yards or less, thrown on rhythm. Tags: depth short; timing quick; situations twoMinute; traits quick.

### Shotgun: Intermediate

- **Smash** (`shotgun.intermediatePass.smash`): Each outside receiver hitches short while the inside receiver runs a corner route over the top of him. Tags: depth intermediate; timing standard; situations redZone; traits highLow.
- **Flood** (`shotgun.intermediatePass.flood`): Three routes fill the right side at three depths: a go, an out at 12 and the back in the flat. Tags: depth intermediate; timing standard; situations none; traits highLow, flood.
- **Drive** (`shotgun.intermediatePass.drive`): The outside receiver drags shallow and the slot receiver digs in right behind him. Tags: depth intermediate; timing standard; situations none; traits levels.
- **Levels** (`shotgun.intermediatePass.levels`): The slot receiver breaks in at 9 yards and the outside receiver digs in from the other side at 13, with a curl between them. Tags: depth intermediate; timing standard; situations none; traits levels. Default.
- **Dagger** (`shotgun.intermediatePass.dagger`): The slot receiver runs up the seam to clear the middle and the outside receiver digs in at 15 behind him. Tags: depth intermediate; timing slow; situations longYardage; traits levels.

### Shotgun: Deep

- **Four Verticals** (`shotgun.deepPass.fourVerticals`): Four receivers run straight up the field, two outside and two up the seams. Tags: depth deep; timing slow; situations longYardage, twoMinute; traits verticals. Default.
- **Post Wheel** (`shotgun.deepPass.postWheel`): The right receiver runs a post and the slot receiver wheels up the sideline behind it. Tags: depth deep; timing slow; situations none; traits none.
- **Post Dig** (`shotgun.deepPass.postDig`): The right receiver runs a post while the slot receiver digs in under it at 12. Tags: depth deep; timing slow; situations longYardage; traits none.
- **Fades** (`shotgun.deepPass.fades`): Both outside receivers fade to the sidelines with the slot receiver up the seam and the back in the flat. Tags: depth deep; timing slow; situations redZone; traits highLow, verticals, isolation.

### Shotgun: Screen

- **Back Screen** (`shotgun.screenPass.backScreen`): The line lets the rush come, then releases left in front of the back, who catches it behind them. Tags: depth behind; timing slow; situations longYardage; traits screenBack. Default.
- **Bubble Screen** (`shotgun.screenPass.bubbleScreen`): The slot receiver bubbles out behind the line for a quick throw while the outside receiver blocks for him. Tags: depth behind; timing quick; situations none; traits quick, screenWide.
- **Tunnel Screen** (`shotgun.screenPass.tunnelScreen`): The right receiver steps back inside behind the line and catches it with the line releasing in front of him. Tags: depth behind; timing standard; situations longYardage; traits screenWide.

### Shotgun: Play action

- **PA Crossers** (`shotgun.playAction.paCrossers`): After a run fake the tight end drags across and the slot receiver crosses the other way at 12 yards. Tags: depth intermediate; timing slow; situations none; traits crossers, levels.
- **PA Post** (`shotgun.playAction.paPost`): After a run fake the left receiver breaks early on a long post toward the middle with the tight end dragging under it. Tags: depth intermediate; timing slow; situations none; traits none. Default.
- **PA Flood** (`shotgun.playAction.paFlood`): After a run fake three routes fill the right side: a go, an out at 12 and the back slipping to the flat. Tags: depth intermediate; timing slow; situations none; traits highLow, flood.

### Under center: Inside run

- **Inside Zone** (`underCenter.insideRun.insideZone`): The line steps to the right together and the back picks a crease between the guards. Tags: timing standard; situations runClock, backedUp; traits zone. Default.
- **Power** (`underCenter.insideRun.power`): The right guard and tight end block down, the right tackle holds his man outside, and the back follows the pulling left guard between them. Tags: timing standard; situations shortYardage, redZone; traits gap.
- **Lead** (`underCenter.insideRun.lead`): The right tight end comes across and leads the back through the hole beside the center. Tags: timing standard; situations shortYardage, goalLine, backedUp; traits gap, lead.
- **Trap** (`underCenter.insideRun.trap`): The line lets one defender through, the right guard traps him, and the back hits the gap he left. Tags: timing quick; situations none; traits gap.

### Under center: Outside run

- **Outside Zone** (`underCenter.outsideRun.outsideZone`): The line and both tight ends reach to the right and the back stretches the run to the edge. Tags: timing standard; situations runClock; traits zone, perimeter. Default.
- **Toss** (`underCenter.outsideRun.toss`): A quick pitch to the left with the left guard and tackle pulling out in front of the back. Tags: timing standard; situations none; traits gap, perimeter.
- **Counter** (`underCenter.outsideRun.counter`): The back steps right, then cuts back left off tackle behind the pulling right guard and tight end. Tags: timing slow; situations none; traits gap, misdirection.

### Under center: QB sneak

- **Sneak** (`underCenter.qbSneak.sneak`): The quarterback takes the snap and pushes straight ahead behind the center. Tags: timing quick; situations shortYardage, goalLine, backedUp; traits none. Default.
- **Wedge** (`underCenter.qbSneak.wedge`): The line and both tight ends close into a wedge and the quarterback follows it with the back pushing from behind. Tags: timing quick; situations shortYardage, goalLine; traits wedge.

### Under center: Short

- **Slant Flat** (`underCenter.shortPass.slantFlat`): The right receiver slants inside while the tight end runs to the flat under him. Tags: depth short; timing quick; situations shortYardage, redZone; traits quick. Default.
- **Curl Flat** (`underCenter.shortPass.curlFlat`): Both receivers curl at 8 yards and both tight ends run to the flats under them. Tags: depth short; timing standard; situations none; traits highLow.
- **Hitches** (`underCenter.shortPass.hitches`): All four receivers run short hitches and turn back to the quarterback, with the back swinging out. Tags: depth short; timing quick; situations twoMinute; traits quick.

### Under center: Intermediate

- **Flood** (`underCenter.intermediatePass.flood`): Three routes fill the left side at three depths: a go, the tight end's out at 12 and the back in the flat. Tags: depth intermediate; timing standard; situations none; traits highLow, flood.
- **Dig** (`underCenter.intermediatePass.dig`): The right receiver digs in at 13 yards with a curl inside him and a comeback on the far side. Tags: depth intermediate; timing standard; situations none; traits levels. Default.
- **Curls** (`underCenter.intermediatePass.curls`): All four receivers curl back to the quarterback, the outside two at 12 yards and the tight ends at 10. Tags: depth intermediate; timing standard; situations longYardage; traits none.

### Under center: Deep

- **Post Dig** (`underCenter.deepPass.postDig`): The right receiver runs a post while the tight end beside him digs in under it at 12. Tags: depth deep; timing slow; situations longYardage; traits none.
- **Post Corner** (`underCenter.deepPass.postCorner`): The left receiver runs a post while the tight end beside him breaks to the corner behind it. Tags: depth deep; timing slow; situations none; traits highLow.
- **Fades** (`underCenter.deepPass.fades`): Both receivers release outside and run up the sidelines, the left one on a fade, while the tight ends and the back run up the seams. Tags: depth deep; timing slow; situations redZone, twoMinute; traits verticals. Default.

### Under center: Screen

- **Back Screen** (`underCenter.screenPass.backScreen`): The line lets the rush come, then releases right in front of the back, who catches it behind them. Tags: depth behind; timing slow; situations longYardage; traits screenBack. Default.
- **Tight End Screen** (`underCenter.screenPass.tightEndScreen`): The left tight end blocks for a count, slips out behind the line and catches it with the line releasing his way. Tags: depth behind; timing slow; situations none; traits screenBack.

### Under center: Play action

- **Bootleg** (`underCenter.playAction.bootleg`): The quarterback fakes the handoff right and rolls out left, with a flat, a drag and a comeback all coming his way. Tags: depth short; timing slow; situations shortYardage, redZone; traits highLow, boot.
- **PA Post** (`underCenter.playAction.paPost`): After a run fake the right receiver breaks early on a long post toward the middle with the tight end dragging under it. Tags: depth intermediate; timing slow; situations none; traits none. Default.
- **PA Crossers** (`underCenter.playAction.paCrossers`): After a run fake the right tight end drags across and the left tight end crosses the other way at 12 yards. Tags: depth intermediate; timing slow; situations none; traits crossers, levels.
- **PA Flood** (`underCenter.playAction.paFlood`): After a run fake three routes fill the right side: a go, the tight end's out at 12 and the back slipping to the flat. Tags: depth intermediate; timing slow; situations none; traits highLow, flood.

### Pistol: Inside run

- **Inside Zone** (`pistol.insideRun.insideZone`): The line steps to the right together and the back, running downhill, picks a crease between the guards. Tags: timing standard; situations runClock; traits zone. Default.
- **Dive** (`pistol.insideRun.dive`): A fast handoff straight ahead behind the center with every lineman blocking the man in front of him. Tags: timing quick; situations shortYardage, goalLine; traits gap.
- **Power** (`pistol.insideRun.power`): The right guard and tight end block down, the right tackle holds his man outside, and the back follows the pulling left guard between them. Tags: timing standard; situations shortYardage, redZone; traits gap.

### Pistol: Outside run

- **Outside Zone** (`pistol.outsideRun.outsideZone`): The line reaches to the right and the back stretches the run to the tight end's edge. Tags: timing standard; situations runClock; traits zone, perimeter. Default.
- **Toss** (`pistol.outsideRun.toss`): A quick pitch to the left with the left guard and tackle pulling and the slot receiver cracking inside. Tags: timing standard; situations none; traits gap, perimeter.
- **Sweep** (`pistol.outsideRun.sweep`): Both guards pull to the right and the back takes the handoff wide around the tight end's down block. Tags: timing slow; situations none; traits gap, perimeter.

### Pistol: QB sneak

- **Sneak** (`pistol.qbSneak.sneak`): The quarterback takes the snap and pushes straight ahead behind the center. Tags: timing quick; situations shortYardage, goalLine; traits none. Default.

### Pistol: Short

- **Stick** (`pistol.shortPass.stick`): The tight end sits just past the sticks, the back runs to the flat beside him and the outside receiver clears deep. Tags: depth short; timing quick; situations shortYardage; traits quick, highLow.
- **Slant Flat** (`pistol.shortPass.slantFlat`): The right receiver slants inside while the tight end runs to the flat under him. Tags: depth short; timing quick; situations shortYardage, redZone; traits quick. Default.
- **Quick Outs** (`pistol.shortPass.quickOuts`): Three receivers break to the sidelines at 5 yards or less, thrown on rhythm. Tags: depth short; timing quick; situations twoMinute; traits quick.

### Pistol: Intermediate

- **Smash** (`pistol.intermediatePass.smash`): Each outside receiver hitches short while the inside receiver runs a corner route over the top of him. Tags: depth intermediate; timing standard; situations redZone; traits highLow.
- **Drive** (`pistol.intermediatePass.drive`): The tight end drags shallow across the field and the receiver outside him digs in at 13 right behind. Tags: depth intermediate; timing standard; situations none; traits levels. Default.
- **Deep Cross** (`pistol.intermediatePass.deepCross`): The slot receiver crosses the whole field at 12 yards with the tight end dragging the other way under him. Tags: depth intermediate; timing standard; situations none; traits crossers, levels.

### Pistol: Deep

- **Four Verticals** (`pistol.deepPass.fourVerticals`): Four receivers run straight up the field, two outside and two up the seams. Tags: depth deep; timing slow; situations longYardage, twoMinute; traits verticals.
- **Post Wheel** (`pistol.deepPass.postWheel`): The left receiver runs a post and the back wheels out of the backfield up the sideline behind it. Tags: depth deep; timing slow; situations none; traits none.
- **Double Post** (`pistol.deepPass.doublePost`): The two left receivers both run posts, one behind the other, with a go, a seam and the back up the other side. Tags: depth deep; timing slow; situations longYardage; traits verticals. Default.

### Pistol: Screen

- **Back Screen** (`pistol.screenPass.backScreen`): The line lets the rush come, then releases right in front of the back, who catches it behind them. Tags: depth behind; timing slow; situations longYardage; traits screenBack. Default.
- **Bubble Screen** (`pistol.screenPass.bubbleScreen`): The slot receiver bubbles out behind the line for a quick throw while the outside receiver blocks for him. Tags: depth behind; timing quick; situations none; traits quick, screenWide.

### Pistol: Play action

- **Bootleg** (`pistol.playAction.bootleg`): The quarterback fakes the handoff left and rolls out right, with a flat, a deep cross and a comeback all coming his way. Tags: depth intermediate; timing slow; situations redZone; traits highLow, boot.
- **PA Post** (`pistol.playAction.paPost`): After a run fake the right receiver breaks early on a long post toward the middle with the tight end dragging under it. Tags: depth intermediate; timing slow; situations none; traits none. Default.
- **PA Dig** (`pistol.playAction.paDig`): After a run fake the right receiver digs in at 13 behind the linebackers, with a drag under it and a post over it. Tags: depth intermediate; timing slow; situations none; traits levels, isolation.

### Empty: Inside run

- **QB Draw** (`empty.insideRun.qbDraw`): The line and the tight end show pass, then the quarterback runs up the middle behind them. Tags: timing slow; situations longYardage; traits misdirection. Default.
- **QB Power** (`empty.insideRun.qbPower`): The left guard and tight end block down, the left tackle holds his man outside, and the quarterback follows the pulling right guard between them. Tags: timing standard; situations shortYardage, redZone; traits gap.

### Empty: Outside run

- **QB Sweep** (`empty.outsideRun.qbSweep`): Both guards pull to the right while the rest of the line reaches that way, the slot receiver cracks inside and the quarterback sweeps around them. Tags: timing slow; situations none; traits zone, perimeter. Default.

### Empty: QB sneak

- **Sneak** (`empty.qbSneak.sneak`): The quarterback takes the snap and pushes straight ahead behind the center. Tags: timing quick; situations shortYardage, goalLine; traits none. Default.

### Empty: Short

- **Mesh** (`empty.shortPass.mesh`): The two slot receivers cross shallow over the middle, with corner routes outside and the tight end sitting over the ball. Tags: depth short; timing standard; situations shortYardage, redZone; traits crossers.
- **Stick** (`empty.shortPass.stick`): The tight end sits just past the sticks with the slot receiver in the flat beside him and a slant outside. Tags: depth short; timing quick; situations shortYardage; traits quick. Default.
- **Spacing** (`empty.shortPass.spacing`): Five receivers spread across the field at 3 to 5 yards and sit down in the open spots between defenders. Tags: depth short; timing quick; situations shortYardage, goalLine; traits quick.
- **Hitches** (`empty.shortPass.hitches`): All five receivers run short hitches and turn back to the quarterback. Tags: depth short; timing quick; situations twoMinute; traits quick.

### Empty: Intermediate

- **Levels** (`empty.intermediatePass.levels`): The tight end crosses shallow and the outside receiver digs in at 13 behind him, with a curl between them. Tags: depth intermediate; timing standard; situations none; traits levels. Default.
- **Smash** (`empty.intermediatePass.smash`): Each outside receiver hitches short while the slot receiver runs a corner route over the top of him. Tags: depth intermediate; timing standard; situations redZone; traits highLow.
- **Dagger** (`empty.intermediatePass.dagger`): The right slot receiver runs up the seam to clear the middle and the outside receiver digs in at 15 behind him. Tags: depth intermediate; timing slow; situations longYardage; traits highLow, levels.

### Empty: Deep

- **Four Verticals** (`empty.deepPass.fourVerticals`): Four receivers run straight up the field, two outside and two up the seams, with the left slot receiver on a post between them. Tags: depth deep; timing slow; situations longYardage, twoMinute; traits verticals. Default.
- **Double Post** (`empty.deepPass.doublePost`): The two left receivers both run posts, one behind the other, with a dig coming in under them from the right. Tags: depth deep; timing slow; situations longYardage; traits levels.
- **Fades** (`empty.deepPass.fades`): Both outside receivers fade to the sidelines with one slot receiver up the seam and quick outlets underneath. Tags: depth deep; timing slow; situations redZone; traits highLow, verticals.

### Empty: Screen

- **Bubble Screen** (`empty.screenPass.bubbleScreen`): The left slot receiver bubbles out behind the line while the outside receiver and the tight end block for him. Tags: depth behind; timing standard; situations none; traits screenWide. Default.
- **Tunnel Screen** (`empty.screenPass.tunnelScreen`): The right receiver steps back inside behind the line and catches it with the line releasing in front of him. Tags: depth behind; timing standard; situations longYardage; traits highLow, screenWide.

### Empty: Play action

- **PA Seam** (`empty.playAction.paSeam`): After a quick fake the left slot receiver runs up the seam, with a go and a corner on the other side. Tags: depth deep; timing slow; situations none; traits none. Default.

### Heavy: Inside run

- **Dive** (`heavy.insideRun.dive`): A fast handoff straight ahead behind the center with every lineman blocking the man in front of him. Tags: timing quick; situations shortYardage, goalLine, backedUp; traits gap. Default.
- **Power** (`heavy.insideRun.power`): The right side blocks down, the left guard pulls around, and the back follows him off the right guard. Tags: timing standard; situations shortYardage, goalLine, runClock; traits gap.
- **Lead** (`heavy.insideRun.lead`): The wing tight end comes across and leads the back through the hole beside the center. Tags: timing standard; situations shortYardage, goalLine; traits gap, lead.

### Heavy: Outside run

- **Toss** (`heavy.outsideRun.toss`): A quick pitch to the right with the line reaching that way and the wing tight end leading the back around the edge. Tags: timing standard; situations runClock; traits zone, perimeter, lead. Default.
- **Off Tackle** (`heavy.outsideRun.offTackle`): The left side blocks down, a guard pulls, and the back runs just outside the left tackle. Tags: timing standard; situations shortYardage, redZone; traits gap.

### Heavy: QB sneak

- **Sneak** (`heavy.qbSneak.sneak`): The quarterback takes the snap and pushes straight ahead behind the center. Tags: timing quick; situations shortYardage, goalLine, backedUp; traits none. Default.
- **Wedge** (`heavy.qbSneak.wedge`): The line and the tight ends close into a wedge and the quarterback follows it with the back pushing from behind. Tags: timing quick; situations shortYardage, goalLine; traits wedge.

### Heavy: Short

- **Stick** (`heavy.shortPass.stick`): The right tight end sits just past the sticks with the wing in the flat beside him and a slant from the other side. Tags: depth short; timing quick; situations shortYardage, goalLine; traits quick.
- **Slant Flat** (`heavy.shortPass.slantFlat`): The wing tight end slants inside while the tight end beside him runs to the flat under him. Tags: depth short; timing quick; situations shortYardage, redZone; traits quick. Default.

### Heavy: Intermediate

- **Corner Flat** (`heavy.intermediatePass.cornerFlat`): The wing tight end breaks to the corner at 12 while the tight end beside him runs to the flat under it. Tags: depth intermediate; timing standard; situations redZone, goalLine; traits highLow.
- **Deep Cross** (`heavy.intermediatePass.deepCross`): The left tight end crosses the whole field at 12 yards with a curl and a dig coming in from the other side. Tags: depth intermediate; timing standard; situations none; traits isolation. Default.

### Heavy: Deep

- **Seams** (`heavy.deepPass.seams`): All three tight ends and the back run straight up the seams. Tags: depth deep; timing slow; situations none; traits verticals. Default.
- **Post** (`heavy.deepPass.post`): Eight stay in to block and the left tight end runs a post alone on his side, with one drag under it. Tags: depth deep; timing slow; situations backedUp; traits crossers, isolation.

### Heavy: Screen

- **Back Screen** (`heavy.screenPass.backScreen`): The line lets the rush come, then releases right in front of the back, who catches it behind them. Tags: depth behind; timing slow; situations none; traits screenBack. Default.
- **Tight End Screen** (`heavy.screenPass.tightEndScreen`): The left tight end blocks for a count, slips out behind the line and catches it with the line releasing his way. Tags: depth behind; timing slow; situations shortYardage; traits screenBack.

### Heavy: Play action

- **Bootleg** (`heavy.playAction.bootleg`): The quarterback fakes the handoff right and rolls out left, with a tight end in the flat and another crossing deep his way. Tags: depth intermediate; timing slow; situations shortYardage, goalLine; traits highLow, isolation, boot.
- **PA Seam** (`heavy.playAction.paSeam`): After a run fake all three tight ends run straight up the seams behind the linebackers. Tags: depth deep; timing slow; situations none; traits verticals.
- **PA Post** (`heavy.playAction.paPost`): After a run fake the wing tight end breaks early on a long post across the middle with another tight end dragging under it. Tags: depth intermediate; timing slow; situations shortYardage; traits crossers. Default.

## Defense

### Base Cover 3

- **Cover 3 Sky** (`baseCover3.sky`): Three deep with a safety rotating down to the right flat and three linebackers underneath. Tags: timing standard; pressure none; situations none; traits singleHigh, zone. Default.
- **Cover 3 Buzz** (`baseCover3.buzz`): Three deep with a safety dropping into the middle hook and the outside linebackers widening to both flats. Tags: timing standard; pressure none; situations none; traits singleHigh, zone.
- **Cover 3 Twist** (`baseCover3.twist`): Three deep behind a four-man rush where the two tackles cross to free one of them. Tags: timing slow; pressure none; situations longYardage; traits singleHigh, zone, stunt.

### Base Cover 2

- **Cover 2** (`baseCover2.cover2`): Two safeties split the deep field and five defenders spread across the short zones. Tags: timing standard; pressure none; situations none; traits twoHigh, zone. Default.
- **Cover 2 Middle Deep** (`baseCover2.middleDeep`): Cover 2 with the middle linebacker running back to 9 yards to close the hole between the safeties and the other two squeezing inside. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, zone.
- **Cover 2 Exchange** (`baseCover2.exchange`): Cover 2 where the left end drops into the hook zone and the linebacker behind him rushes instead. Tags: timing slow; pressure exchange; situations none; traits twoHigh, zone, exchange.

### Run Stuff

- **Eight in the Box** (`runStuff.eightInTheBox`): A safety walks down beside the linebackers for an eighth run defender, with man coverage behind and one safety deep. Tags: timing standard; pressure none; situations shortYardage, runClock; traits singleHigh, man, loadedBox. Default.
- **Strong Run Blitz** (`runStuff.strongRunBlitz`): The safety in the box blitzes off the right edge at the snap, with man coverage behind him. Tags: timing quick; pressure blitz; situations shortYardage, backedUp; traits singleHigh, man, pressure, loadedBox.
- **Pinch** (`runStuff.pinch`): Both ends crash inside to close the middle, with eight in the box and man coverage behind. Tags: timing quick; pressure none; situations shortYardage, goalLine; traits singleHigh, man, loadedBox, pinch.

### Nickel Cover 3

- **Cover 3 Sky** (`nickelCover3.sky`): Three deep with a safety rotating down on the right inside the slot corner and both linebackers in the hooks. Tags: timing standard; pressure none; situations none; traits singleHigh, zone, lightBox. Default.
- **Cover 3 Buzz** (`nickelCover3.buzz`): Three deep with a safety dropping into the middle hook and a linebacker widening to the left. Tags: timing standard; pressure none; situations none; traits singleHigh, zone, lightBox.
- **Cover 3 Twist** (`nickelCover3.twist`): Three deep behind a four-man rush where the right end crashes inside and the tackle loops around him. Tags: timing slow; pressure none; situations longYardage; traits singleHigh, zone, stunt, lightBox.
- **Cover 3 Exchange** (`nickelCover3.exchange`): Three deep where the right end drops into the hook zone and the linebacker behind him rushes instead. Tags: timing slow; pressure exchange; situations none; traits singleHigh, zone, exchange, lightBox.

### Nickel Cover 4

- **Quarters** (`nickelCover4.quarters`): Both corners and both safeties each take a deep quarter of the field, with three defenders underneath. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, fourDeep, zone, lightBox. Default.
- **Quarter Quarter Half** (`nickelCover4.quarterQuarterHalf`): Quarters on the left, and on the right one safety takes the deep half while the corner sits in the flat. Tags: timing standard; pressure none; situations none; traits twoHigh, zone, lightBox.
- **Quarters Twist** (`nickelCover4.quartersTwist`): Quarters behind a four-man rush where the left end crashes inside and the tackle loops around him. Tags: timing slow; pressure none; situations longYardage; traits twoHigh, fourDeep, zone, stunt, lightBox.

### Nickel Cover 2

- **Cover 2** (`nickelCover2.cover2`): Two safeties split the deep field, the corners sit in the flats, two linebackers cover the middle underneath and the slot corner helps on the right. Tags: timing standard; pressure none; situations none; traits twoHigh, zone, lightBox. Default.
- **Cover 2 Middle Deep** (`nickelCover2.middleDeep`): Cover 2 with one linebacker running back to 9 yards to close the hole between the safeties and the slot corner squeezing inside. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, zone, lightBox.
- **Cover 2 Trap** (`nickelCover2.trap`): Cover 2 with both corners up at the line, sitting on the short outside throw to jump it. Tags: timing standard; pressure none; situations shortYardage; traits twoHigh, zone, press, lightBox.

### Nickel 2-Man

- **2-Man** (`nickel2Man.twoMan`): Five defenders play man coverage underneath with two safeties splitting the deep field behind them. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, man, lightBox. Default.
- **2-Man Bracket** (`nickel2Man.bracket`): 2-Man with three rushers: the right end peels off to take the back and the freed linebacker doubles the right slot. Tags: timing standard; pressure none; situations longYardage, twoMinute; traits twoHigh, man, bracket, lightBox.
- **2-Man Spy** (`nickel2Man.spy`): 2-Man with three rushers: a tackle drops off the line and mirrors the quarterback. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, man, spy, lightBox.

### Nickel Cover 1

- **Cover 1 Robber** (`nickelCover1.robber`): Man coverage with one safety deep and the other dropping down into the middle to rob crossing routes. Tags: timing standard; pressure none; situations none; traits singleHigh, man, robber, lightBox. Default.
- **Cover 1 Spy** (`nickelCover1.spy`): Man coverage with one safety deep, the other safety on the back and a linebacker mirroring the quarterback. Tags: timing standard; pressure none; situations redZone; traits singleHigh, man, spy, lightBox.
- **Cover 1 Press** (`nickelCover1.press`): Cover 1 Robber with all three corners up at the line to jam their receivers at the snap. Tags: timing standard; pressure none; situations shortYardage, redZone; traits singleHigh, man, press, robber, lightBox.
- **Cover 1 Twist** (`nickelCover1.twist`): Cover 1 Robber behind a four-man rush where the two tackles cross to free one of them. Tags: timing slow; pressure none; situations longYardage; traits singleHigh, man, stunt, robber, lightBox.

### Nickel Cover 1 Blitz

- **Middle Blitz** (`nickelCover1Blitz.middleBlitz`): One linebacker blitzes up the middle as a fifth rusher, with man coverage and one safety deep. Tags: timing quick; pressure blitz; situations none; traits singleHigh, man, pressure.
- **Slot Blitz** (`nickelCover1Blitz.slotBlitz`): The slot corner blitzes off the right edge and the safety behind him takes his receiver. Tags: timing quick; pressure blitz; situations longYardage; traits singleHigh, man, pressure.
- **Double A Gap** (`nickelCover1Blitz.doubleAGap`): Both linebackers blitz the gaps beside the center, the left end drops out to take the second receiver on his side and the safety in the box takes the back. Tags: timing quick; pressure blitz; situations longYardage; traits singleHigh, man, pressure. Default.
- **Safety Blitz** (`nickelCover1Blitz.safetyBlitz`): The safety lined up in the box blitzes inside the right end, with the linebackers in man coverage. Tags: timing quick; pressure blitz; situations backedUp; traits singleHigh, man, pressure.

### Dime Cover 4

- **Quarters** (`dimeCover4.quarters`): Both corners and both safeties each take a deep quarter, with a linebacker and two slot corners underneath. Tags: timing standard; pressure none; situations longYardage; traits twoHigh, fourDeep, zone, lightBox. Default.
- **Drop Eight** (`dimeCover4.dropEight`): Only three rush: a tackle drops into the short middle so eight defenders cover. Tags: timing standard; pressure none; situations longYardage, twoMinute; traits twoHigh, fourDeep, zone, lightBox.
- **Quarters Twist** (`dimeCover4.quartersTwist`): Quarters behind a four-man rush where the two tackles cross to free one of them. Tags: timing slow; pressure none; situations longYardage; traits twoHigh, fourDeep, zone, stunt, lightBox.

### Dime Cover 0 Blitz

- **All Out** (`dimeCover0Blitz.allOut`): Both safeties blitz off the edges for six rushers, with man coverage on everyone and nobody deep. Tags: timing quick; pressure blitz; situations shortYardage, goalLine; traits noDeep, man, pressure. Default.
- **Corner Blitz** (`dimeCover0Blitz.cornerBlitz`): The left corner and the linebacker blitz, and the safeties come down to take the receiver and the back they left. Tags: timing quick; pressure blitz; situations longYardage; traits noDeep, man, pressure.
- **Overload** (`dimeCover0Blitz.overload`): The slot corner and a safety both blitz from the right, putting four rushers on that side of the line. Tags: timing quick; pressure blitz; situations longYardage; traits noDeep, man, pressure, overload.

### Goal Line

- **Goal Line** (`goalLine.goalLine`): Five linemen charge straight ahead with man coverage on every receiver and a safety over the ball. Tags: timing standard; pressure none; situations shortYardage, goalLine; traits noDeep, man, pressure, loadedBox. Default.
- **Goal Line Pinch** (`goalLine.pinch`): Both ends crash inside to pile up the middle, with man coverage on every receiver. Tags: timing quick; pressure none; situations shortYardage, goalLine; traits noDeep, man, pressure, loadedBox, pinch.

### Prevent

- **Prevent** (`prevent.prevent`): Three rush and eight drop deep to keep every throw in front of them. Tags: timing standard; pressure none; situations twoMinute, longYardage; traits fourDeep, zone, lightBox. Default.
- **Prevent Spy** (`prevent.spy`): Prevent with the linebacker mirroring the quarterback instead of dropping. Tags: timing standard; pressure none; situations twoMinute; traits fourDeep, zone, spy, lightBox.
