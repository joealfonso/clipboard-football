# MENUS.md

Every menu you see when you call a play, in the order you see them. Each menu has a number for each choice, and you press that number to pick it. No menu has more than seven choices. This file lists what is on each menu and what each choice means; how the menus look is still to be designed.

The list here must match the game's menu file, `data/calls/catalog.json`. A test fails if they drift apart, so change both together.

## How the menus fit together

- On offense, you pick a play type first, then the play. Before any run or pass you also pick a formation. The computer coach picks the play first and the formation second; either order ends in the same call.
- After your touchdown you choose between the extra point kick and going for two. Going for two takes you to the play type menu, where only Run and Pass can be picked.
- On defense, you pick a package (how many defensive backs), then one of the plays in it. There are 13 defensive plays in all.
- Some choices are off in some situations. Kick is only on 4th down, or on any down in the last two minutes of a half. Kick and Clock are off on a try. A choice that is off keeps its number, so the numbers never shift. Whether it is hidden or greyed out is a design decision still to come.
- The computer coach chooses from the same menus, using how often real NFL teams made each call in the same situation.

## Offense: Play type

Shown: Every scrimmage down. On a two-point try, only Run and Pass.

1. Run: Keep the ball on the ground.
2. Pass: Throw the ball.
3. Kick: Punt it away or try a field goal. Only on 4th down, or on any down in the last two minutes of a half.
4. Clock: Stop the clock or run it down.

## Offense: Formation

Shown: Before a Run or Pass play.

1. Shotgun: The quarterback stands a few yards behind the center.
2. Under center: The quarterback takes the snap directly from the center.
3. Pistol: A short shotgun with the running back lined up directly behind the quarterback.
4. Empty: No running back. Everyone except the quarterback spreads out to catch passes.
5. Heavy: Extra linemen or tight ends packed in tight, built to push for short yards.

## Offense: Run

Shown: After Run.

1. Inside run: A handoff straight up the middle, between the guards.
2. Outside run: A handoff toward the edge, outside the tackles.
3. QB sneak: The quarterback takes the snap and pushes forward behind the center for a yard or two.

## Offense: Pass

Shown: After Pass.

1. Short: A quick throw less than 10 yards past the line.
2. Intermediate: A throw 10 to 19 yards past the line.
3. Deep: A long throw, 20 yards or more past the line.
4. Screen: A short throw behind the line, with blockers out in front of the catcher.
5. Play action: Fake a handoff first, then throw.

## Offense: Kick

Shown: After Kick.

1. Punt: Kick the ball away to pin the other team deep.
2. Field goal: Kick at the goal posts for three points.

## Offense: Clock

Shown: After Clock.

1. Spike: Throw the ball into the ground to stop the clock. Uses up a down.
2. Kneel: The quarterback kneels down to keep the clock running.

## After a touchdown

Shown: The try after your touchdown.

1. Kick extra point: Kick for one point.
2. Go for two: Run one play from close in for two points.

## Kickoff

Shown: Your kickoff. Only you choose here for now; the computer has no kickoff caller yet.

1. Kickoff: A normal kick deep to the other team.
2. Onside kick: A short kick your team tries to recover.

## Defense: Package

Shown: Every scrimmage down and every two-point try.

1. Base: Four defensive backs, built to stop the run.
2. Nickel: Five defensive backs, the everyday mix of run and pass defense.
3. Dime: Six defensive backs, for obvious passing downs.
4. Specials: Goal line and prevent.

## Defense: Base

Shown: After Base.

1. Base Cover 3: Four defensive backs, three deep defenders split the field in thirds, four rushers.
2. Base Cover 2: Four defensive backs, two deep safeties split the field in halves, four rushers.
3. Run Stuff: Eight or more defenders near the line, one deep safety, man coverage behind them.

## Defense: Nickel

Shown: After Nickel.

1. Nickel Cover 3: Five defensive backs, three deep defenders in zones, four rushers.
2. Nickel Cover 4: Five defensive backs, four deep defenders each guard a quarter of the field, four rushers.
3. Nickel Cover 2: Five defensive backs, two deep safeties split the field in halves, zones underneath, four rushers.
4. Nickel 2-Man: Five defensive backs, two deep safeties split the field, everyone else plays man.
5. Nickel Cover 1: Five defensive backs, one deep safety, man coverage underneath, four rushers.
6. Nickel Cover 1 Blitz: Five defensive backs, one deep safety, man coverage, five or more rushers.

## Defense: Dime

Shown: After Dime.

1. Dime Cover 4: Six defensive backs, four deep zones, four rushers. Gives up short gains to stop long ones.
2. Dime Cover 0 Blitz: Six defensive backs, no deep safety, pure man coverage, six or more rushers.

## Defense: Specials

Shown: After Specials.

1. Goal Line: Three or fewer defensive backs, everyone crowded at the line to stop a short run.
2. Prevent: Six or more defensive backs playing deep zones with four or fewer rushers. Stops the long pass, allows short ones.
