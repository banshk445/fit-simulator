## mannequin.glb

Source: user-provided `Ch36_nonPBR.fbx`, an Adobe Fuse/Mixamo-generated bare-body male character (single unified mesh, no separate clothing pieces), exported in T-pose and converted to glTF via Blender.

Chosen over two earlier candidates that were tried and rejected:
- three.js's bundled "X Bot"/basic-human-male mannequins — visually too stylized/robotic (blocky segmented shoulder geometry baked into the body mesh, no face).
- A Mixamo "Remy" character — comes pre-dressed with separate `Body`/`Tops`/`Bottoms`/... meshes, and the `Body` mesh has no skin modeled under the torso region normally covered by `Tops`; hiding or removing `Tops` leaves a literal hole in the collision surface (garment clips straight through).

Ch36's single-mesh, unclothed body avoids both problems. Bone hierarchy uses Mixamo naming with a numeric suffix (`mixamorig1:LeftArm`, `mixamorig1:LeftForeArm`, ...), matched via substring (not exact string) by `classifyBone()` / `boneUtils.ts`, so the naming variant doesn't require code changes.

## tshirt.glb

Source: "T-Shirt Low Poly" by Chirag.Vijay (https://sketchfab.com/Chirag.Vijay), downloaded from
https://sketchfab.com/3d-models/t-shirt-low-poly-3e4b13a502884acfbd79cee0f9cd8876 — license CC-BY-4.0
(http://creativecommons.org/licenses/by/4.0/), attribution required.

Single mesh, single material, 32,102 verts / 61,056 tris. UVs are a genuine flat-pattern unwrap with
separate islands for front torso, back torso, left/right sleeves, collar band, and hem/cuff trim — but
the UV values aren't normalized to [0,1] (they run up to ~3.0), relying on `RepeatWrapping` + `fract()`
to land inside the single 2048×2048 texture atlas. Front-torso island, after wrapping, occupies roughly
U=[0.090, 0.509] V=[0.057, 0.586] of that atlas (verified by directly parsing the glTF accessors, not by
inspection alone — see the analysis script this session used).
