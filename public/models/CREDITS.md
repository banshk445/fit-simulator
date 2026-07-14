## mannequin.glb

Source: user-provided `Ch36_nonPBR.fbx`, an Adobe Fuse/Mixamo-generated bare-body male character (single unified mesh, no separate clothing pieces), exported in T-pose and converted to glTF via Blender.

Chosen over two earlier candidates that were tried and rejected:
- three.js's bundled "X Bot"/basic-human-male mannequins — visually too stylized/robotic (blocky segmented shoulder geometry baked into the body mesh, no face).
- A Mixamo "Remy" character — comes pre-dressed with separate `Body`/`Tops`/`Bottoms`/... meshes, and the `Body` mesh has no skin modeled under the torso region normally covered by `Tops`; hiding or removing `Tops` leaves a literal hole in the collision surface (garment clips straight through).

Ch36's single-mesh, unclothed body avoids both problems. Bone hierarchy uses Mixamo naming with a numeric suffix (`mixamorig1:LeftArm`, `mixamorig1:LeftForeArm`, ...), matched via substring (not exact string) by `classifyBone()` / `boneUtils.ts`, so the naming variant doesn't require code changes.
