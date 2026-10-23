"""
Spark Backend Face Verification Worker Script
Performs face detection and embedding comparison using InsightFace (buffalo_sc).

Input: JSON via stdin:
{
  "image1_base64": "<base64 encoded image 1>",
  "image2_base64": "<base64 encoded image 2>",
  "threshold": 0.40
}

Output: JSON to stdout:
{
  "success": true,
  "match": true/false,
  "similarity": 0.78,
  "threshold": 0.40,
  "face1_detected": 1,
  "face2_detected": 1,
  "error": null
}
"""

import sys
import json
import base64
import numpy as np
import cv2

def decode_image_base64(b64_string):
    try:
        # Strip data URL prefix if present
        if "," in b64_string:
            b64_string = b64_string.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_string)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        return None

def compute_cosine_similarity(feat1, feat2):
    dot = np.dot(feat1, feat2)
    norm1 = np.linalg.norm(feat1)
    norm2 = np.linalg.norm(feat2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot / (norm1 * norm2))

def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            print(json.dumps({
                "success": False,
                "error": "EMPTY_INPUT",
                "message": "No input JSON received on stdin."
            }))
            sys.exit(0)

        data = json.loads(raw_input)
        img1_b64 = data.get("image1_base64")
        img2_b64 = data.get("image2_base64")
        threshold = float(data.get("threshold", 0.40))

        if not img1_b64 or not img2_b64:
            print(json.dumps({
                "success": False,
                "error": "MISSING_IMAGES",
                "message": "Both image1_base64 and image2_base64 are required."
            }))
            sys.exit(0)

        img1 = decode_image_base64(img1_b64)
        img2 = decode_image_base64(img2_b64)

        if img1 is None:
            print(json.dumps({
                "success": False,
                "error": "INVALID_IMAGE_1",
                "message": "First image could not be decoded as a valid image."
            }))
            sys.exit(0)

        if img2 is None:
            print(json.dumps({
                "success": False,
                "error": "INVALID_IMAGE_2",
                "message": "Second image could not be decoded as a valid image."
            }))
            sys.exit(0)

        # Initialize InsightFace FaceAnalysis
        import insightface
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name='buffalo_sc', providers=['CPUExecutionProvider'])
        app.prepare(ctx_id=0, det_size=(640, 640))

        # Detect faces in image 1 (e.g. verification selfie)
        faces1 = app.get(img1)
        # Detect faces in image 2 (e.g. profile photo)
        faces2 = app.get(img2)

        face1_count = len(faces1)
        face2_count = len(faces2)

        if face1_count == 0:
            print(json.dumps({
                "success": False,
                "error": "NO_FACE_IN_SELFIE",
                "message": "No face detected in the verification selfie. Please ensure good lighting and face the camera directly.",
                "face1_detected": 0,
                "face2_detected": face2_count
            }))
            sys.exit(0)

        if face1_count > 1:
            print(json.dumps({
                "success": False,
                "error": "MULTIPLE_FACES_IN_SELFIE",
                "message": "Multiple faces detected in the verification selfie. Please ensure only you are in the photo.",
                "face1_detected": face1_count,
                "face2_detected": face2_count
            }))
            sys.exit(0)

        if face2_count == 0:
            print(json.dumps({
                "success": False,
                "error": "NO_FACE_IN_PROFILE_PHOTO",
                "message": "No face detected in the selected profile photo. Please select a clearer profile photo.",
                "face1_detected": 1,
                "face2_detected": 0
            }))
            sys.exit(0)

        if face2_count > 1:
            print(json.dumps({
                "success": False,
                "error": "MULTIPLE_FACES_IN_PROFILE_PHOTO",
                "message": "Multiple faces detected in the selected profile photo. Please choose a solo photo for verification.",
                "face1_detected": 1,
                "face2_detected": face2_count
            }))
            sys.exit(0)

        # Extract normalized 512-d feature vectors
        feat1 = faces1[0].normed_embedding
        feat2 = faces2[0].normed_embedding

        similarity = compute_cosine_similarity(feat1, feat2)
        # Clamp to 0.0 - 1.0 range
        similarity = max(0.0, min(1.0, float(similarity)))

        is_match = similarity >= threshold

        print(json.dumps({
            "success": True,
            "match": is_match,
            "similarity": round(similarity, 4),
            "threshold": threshold,
            "face1_detected": 1,
            "face2_detected": 1,
            "model": "insightface_buffalo_sc",
            "error": None
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": "MODEL_INFERENCE_ERROR",
            "message": str(e)
        }))
        sys.exit(0)

if __name__ == "__main__":
    main()
