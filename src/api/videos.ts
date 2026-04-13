import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, getAssetURLs3, mediaTypeToExt } from "./assets";
import { randomBytes } from "node:crypto";
import { type ApiConfig } from "../config";
import { type S3File, type BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `Video file exceeds the maximum allowed size of 1GB`,
    );
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 allowed.");
  }
  const ext = mediaTypeToExt(mediaType);
  const randomName = randomBytes(32).toString("base64url");
  const filename = `${randomName}${ext}`;

  const assetDiskPath = getAssetDiskPath(cfg, filename);
  await Bun.write(assetDiskPath, file);

  const client = cfg.s3Client;
  const s3file: S3File = client.file(filename);
  await s3file.write(Bun.file(assetDiskPath), {
  type: mediaType,
});

  const urlPath = getAssetURLs3(cfg, filename);
  video.videoURL = urlPath;
  updateVideo(cfg.db, video);



  return respondWithJSON(200, null);
}
