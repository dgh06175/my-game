# Assets and licenses

## Original procedural 3D artwork

All 3D animal, diver, coral, rock, seaweed, aquarium, furniture, and exhibit models
in `src/render/models.ts`, and their materials in `src/render/materials.ts`, were
created specifically for this game. They are generated from authored curves,
rounded outlines, sculpted geometry, and layered three-dimensional meshes.
There are no downloaded models, photographs, model textures, or texture fonts.

The original artwork definitions in those two files are dedicated to the public
domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
They may be copied, modified, and redistributed with the game, including in a
public GitHub repository and GitHub Pages deployment. No attribution is required.

The models depict twelve species: clownfish, seahorse, sea turtle, crab,
triggerfish, pufferfish, ray, moray, jellyfish, sea angel, anglerfish, and the
fictional lightweave ray. Artwork is deliberately stylized and is not a scientific
identification reference.

Three.js is a software dependency licensed under the MIT license. The CC0
dedication above applies to this game's original artwork, not to Three.js or
other third-party dependencies. Dependency notices remain in their packages.

## Interface, environment, and sound

The interface icons and species illustrations in `src/ui/icons.ts`, underwater
effects and room geometry in `src/render/scene.ts`, and Web Audio ambience and
effects in `src/audio.ts` are original, created for this project. Apart from the
background music below, no recorded music or sound effects are used. No paid or
attribution-restricted art assets are used.

## Background music

The field station and each dive area loop their own track from `public/audio/`.
The tracks were made for this game by a friend of the project owner and are used
with permission:

| Area | Track | File |
| --- | --- | --- |
| Field station (lobby) | Horizon's Hush | `horizons-hush.mp3` |
| 01 Sunlit Reef | Crystal Clear Ocean | `crystal-clear-ocean.mp3` |
| 02 Sunken Wreck | Endless Descent | `endless-descent.mp3` |
| 03 Luminous Abyss | Fading Sunlight Below | `fading-sunlight-below.mp3` |
