// Onboarding validation and constants

const ALLOWED_GENDERS = ["female", "male", "non-binary", "other"];
const ALLOWED_INTERESTED_IN = ["female", "male", "non-binary", "everyone", "all"];
const ALLOWED_DATING_INTENTIONS = ["vibe", "explore", "intent"];
const ALLOWED_DATING_SPEEDS = ["slow", "moderate", "fast"];
const ALLOWED_PHYSICAL_PACE = [
  "comfortable_taking_time",
  "take_it_slow",
  "open_to_flow",
  "spontaneous"
];
const ALLOWED_OFF_APP_TRANSITIONS = [
  "after_first_in_person_date",
  "after_a_few_messages",
  "after_a_week",
  "comfortable_anytime"
];
const ALLOWED_LOCATION_SOURCES = ["device", "manual"];

const KNOWN_INTERESTS = new Set([
  "specialty_coffee",
  "filter_coffee_dosas",
  "rooftop_cocktails",
  "indie_gigs",
  "heritage_architecture",
  "morning_yoga",
  "weekend_getaways",
  "coastal_sunsets",
  "live_music",
  "art_galleries",
  "hiking",
  "reading",
  "board_games",
  "baking",
  "pottery",
  "photography",
  "cycling",
  "running",
  "food_walks",
  "film_photography",
  "craft_beer",
  "standup_comedy",
  "scenic_drives",
  "techno_nights",
  "meditation",
  "dogs",
  "cats"
]);

const ALLOWED_PROFILE_KEYS = new Set([
  "display_name",
  "date_of_birth",
  "gender",
  "show_gender_on_profile",
  "preferences",
  "dating_intention",
  "dating_speed",
  "interests",
  "bio",
  "prompts",
  "boundaries",
  "boundary_preferences",
  "location",
  "intention", // backward compatibility alias for dating_intention
  "verification_selfie_upload_id",
  "biometric_consent"
]);

function isValidDate(dateString) {
  if (typeof dateString !== "string") return false;
  const regEx = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateString.match(regEx)) return false;
  const d = new Date(dateString);
  const dNum = d.getTime();
  if (!dNum && dNum !== 0) return false;
  return d.toISOString().slice(0, 10) === dateString;
}

function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const today = new Date();
  const birthDate = new Date(birthDateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function isValidTime(timeString) {
  if (typeof timeString !== "string") return false;
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  return timeRegex.test(timeString);
}

function validateProfilePatch(body) {
  const errors = {};

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      isValid: false,
      errors: { body: "Request body must be a JSON object." }
    };
  }

  // Reject unsupported top-level fields
  const unsupportedKeys = Object.keys(body).filter((k) => !ALLOWED_PROFILE_KEYS.has(k));
  if (unsupportedKeys.length > 0) {
    unsupportedKeys.forEach((key) => {
      errors[key] = `Unsupported field '${key}'.`;
    });
    return { isValid: false, errors };
  }

  // 1. display_name
  if (body.display_name !== undefined) {
    if (body.display_name === null) {
      errors.display_name = "display_name cannot be null.";
    } else if (typeof body.display_name !== "string" || body.display_name.trim().length === 0) {
      errors.display_name = "display_name must be a non-empty string.";
    } else if (body.display_name.trim().length < 2 || body.display_name.trim().length > 50) {
      errors.display_name = "display_name must be between 2 and 50 characters.";
    }
  }

  // 2. date_of_birth
  if (body.date_of_birth !== undefined) {
    if (body.date_of_birth === null) {
      errors.date_of_birth = "date_of_birth cannot be null.";
    } else if (!isValidDate(body.date_of_birth)) {
      errors.date_of_birth = "Invalid date format. Expected YYYY-MM-DD.";
    } else {
      const dobDate = new Date(body.date_of_birth);
      const today = new Date();
      if (dobDate > today) {
        errors.date_of_birth = "date_of_birth cannot be in the future.";
      } else {
        const age = calculateAge(body.date_of_birth);
        if (age < 18) {
          errors.date_of_birth = "You must be at least 18 years old to use SPARK.";
        }
      }
    }
  }

  // 3. gender
  if (body.gender !== undefined) {
    if (body.gender === null) {
      errors.gender = "gender cannot be null.";
    } else if (typeof body.gender !== "string" || !ALLOWED_GENDERS.includes(body.gender.toLowerCase())) {
      errors.gender = `gender must be one of: ${ALLOWED_GENDERS.join(", ")}.`;
    }
  }

  // 4. show_gender_on_profile
  if (body.show_gender_on_profile !== undefined) {
    if (typeof body.show_gender_on_profile !== "boolean") {
      errors.show_gender_on_profile = "show_gender_on_profile must be a boolean.";
    }
  }

  // 5. dating_intention / intention
  const intentionVal = body.dating_intention !== undefined ? body.dating_intention : body.intention;
  if (intentionVal !== undefined) {
    if (intentionVal === null) {
      errors.dating_intention = "dating_intention cannot be null.";
    } else if (
      typeof intentionVal !== "string" ||
      !ALLOWED_DATING_INTENTIONS.includes(intentionVal.toLowerCase())
    ) {
      errors.dating_intention = `dating_intention must be one of: ${ALLOWED_DATING_INTENTIONS.join(", ")}.`;
    }
  }

  // 6. dating_speed
  if (body.dating_speed !== undefined) {
    if (body.dating_speed === null) {
      errors.dating_speed = "dating_speed cannot be null.";
    } else if (
      typeof body.dating_speed !== "string" ||
      !ALLOWED_DATING_SPEEDS.includes(body.dating_speed.toLowerCase())
    ) {
      errors.dating_speed = `dating_speed must be one of: ${ALLOWED_DATING_SPEEDS.join(", ")}.`;
    }
  }

  // 7. preferences
  if (body.preferences !== undefined) {
    if (body.preferences === null) {
      errors.preferences = "preferences cannot be null.";
    } else if (typeof body.preferences !== "object" || Array.isArray(body.preferences)) {
      errors.preferences = "preferences must be a JSON object.";
    } else {
      const allowedPrefKeys = new Set([
        "interested_in",
        "interested_in_gender",
        "age_min",
        "min_age",
        "age_max",
        "max_age",
        "distance_km",
        "max_distance_km"
      ]);
      const unsupportedPrefKeys = Object.keys(body.preferences).filter((k) => !allowedPrefKeys.has(k));
      if (unsupportedPrefKeys.length > 0) {
        errors.preferences = `Unsupported preferences key(s): ${unsupportedPrefKeys.join(", ")}.`;
      } else {
        const pref = body.preferences;
        const interestedInVal = pref.interested_in !== undefined ? pref.interested_in : pref.interested_in_gender;
        if (interestedInVal !== undefined) {
          if (Array.isArray(interestedInVal)) {
            if (interestedInVal.length === 0) {
              errors["preferences.interested_in"] = "interested_in list cannot be empty.";
            } else {
              for (const item of interestedInVal) {
                if (typeof item !== "string" || !ALLOWED_INTERESTED_IN.includes(item.toLowerCase())) {
                  errors["preferences.interested_in"] = `Each interested_in value must be one of: ${ALLOWED_INTERESTED_IN.join(", ")}.`;
                  break;
                }
              }
            }
          } else if (typeof interestedInVal === "string") {
            if (!ALLOWED_INTERESTED_IN.includes(interestedInVal.toLowerCase())) {
              errors["preferences.interested_in"] = `interested_in must be one of: ${ALLOWED_INTERESTED_IN.join(", ")}.`;
            }
          } else {
            errors["preferences.interested_in"] = "interested_in must be an array of strings or a string.";
          }
        }

        const resolvedMinAge = pref.age_min !== undefined ? pref.age_min : pref.min_age;
        if (resolvedMinAge !== undefined) {
          if (
            typeof resolvedMinAge !== "number" ||
            !Number.isInteger(resolvedMinAge) ||
            resolvedMinAge < 18 ||
            resolvedMinAge > 100
          ) {
            errors["preferences.age_min"] = "age_min must be an integer between 18 and 100.";
          }
        }

        const resolvedMaxAge = pref.age_max !== undefined ? pref.age_max : pref.max_age;
        if (resolvedMaxAge !== undefined) {
          if (
            typeof resolvedMaxAge !== "number" ||
            !Number.isInteger(resolvedMaxAge) ||
            resolvedMaxAge < 18 ||
            resolvedMaxAge > 100
          ) {
            errors["preferences.age_max"] = "age_max must be an integer between 18 and 100.";
          }
        }

        if (
          resolvedMinAge !== undefined &&
          resolvedMaxAge !== undefined &&
          !errors["preferences.age_min"] &&
          !errors["preferences.age_max"] &&
          resolvedMinAge > resolvedMaxAge
        ) {
          errors["preferences.age_range"] = "age_min cannot be greater than age_max.";
        }

        const resolvedDist = pref.distance_km !== undefined ? pref.distance_km : pref.max_distance_km;
        if (resolvedDist !== undefined) {
          if (
            typeof resolvedDist !== "number" ||
            resolvedDist <= 0 ||
            resolvedDist > 500
          ) {
            errors["preferences.distance_km"] = "distance_km must be a number between 1 and 500 km.";
          }
        }
      }
    }
  }

  // 8. interests
  if (body.interests !== undefined) {
    if (body.interests === null) {
      // Allowed null to clear
    } else if (!Array.isArray(body.interests)) {
      errors.interests = "interests must be an array of string identifiers.";
    } else {
      if (body.interests.length > 20) {
        errors.interests = "A maximum of 20 interests can be selected.";
      }
      const uniqueInterests = new Set();
      for (const item of body.interests) {
        if (typeof item !== "string" || item.trim().length === 0) {
          errors.interests = "Each interest must be a non-empty string identifier.";
          break;
        }
        if (uniqueInterests.has(item.trim().toLowerCase())) {
          errors.interests = `Duplicate interest detected: '${item}'.`;
          break;
        }
        uniqueInterests.add(item.trim().toLowerCase());
      }
    }
  }

  // 9. bio
  if (body.bio !== undefined) {
    if (body.bio === null) {
      // Allowed null to clear
    } else if (typeof body.bio !== "string") {
      errors.bio = "bio must be a string.";
    } else if (body.bio.trim().length > 500) {
      errors.bio = "bio cannot exceed 500 characters.";
    }
  }

  // 10. prompts
  if (body.prompts !== undefined) {
    if (body.prompts === null) {
      // Allowed null to clear
    } else if (!Array.isArray(body.prompts)) {
      errors.prompts = "prompts must be an array of { question, answer } objects.";
    } else {
      if (body.prompts.length > 10) {
        errors.prompts = "A maximum of 10 prompts can be added.";
      }
      const seenQuestions = new Set();
      for (let i = 0; i < body.prompts.length; i++) {
        const p = body.prompts[i];
        if (!p || typeof p !== "object" || Array.isArray(p)) {
          errors[`prompts[${i}]`] = "Each prompt must be an object with question and answer.";
          break;
        }
        if (!p.question || typeof p.question !== "string" || p.question.trim().length === 0) {
          errors[`prompts[${i}].question`] = "Prompt question must be a non-empty string.";
          break;
        }
        if (!p.answer || typeof p.answer !== "string" || p.answer.trim().length === 0) {
          errors[`prompts[${i}].answer`] = "Prompt answer must be a non-empty string.";
          break;
        }
        if (p.question.trim().length > 200) {
          errors[`prompts[${i}].question`] = "Prompt question cannot exceed 200 characters.";
          break;
        }
        if (p.answer.trim().length > 500) {
          errors[`prompts[${i}].answer`] = "Prompt answer cannot exceed 500 characters.";
          break;
        }
        const qKey = p.question.trim().toLowerCase();
        if (seenQuestions.has(qKey)) {
          errors.prompts = `Duplicate prompt question: '${p.question}'.`;
          break;
        }
        seenQuestions.add(qKey);
      }
    }
  }

  // 11. boundaries
  if (body.boundaries !== undefined) {
    if (body.boundaries === null) {
      // Allowed null to clear
    } else if (Array.isArray(body.boundaries)) {
      const seenBoundaries = new Set();
      for (const b of body.boundaries) {
        if (typeof b !== "string" || b.trim().length === 0) {
          errors.boundaries = "Each boundary must be a non-empty string.";
          break;
        }
        if (b.trim().length > 100) {
          errors.boundaries = "Each boundary text cannot exceed 100 characters.";
          break;
        }
        const bKey = b.trim().toLowerCase();
        if (seenBoundaries.has(bKey)) {
          errors.boundaries = `Duplicate boundary detected: '${b}'.`;
          break;
        }
        seenBoundaries.add(bKey);
      }
    } else if (typeof body.boundaries === "object") {
      // Preserved legacy object support
    } else {
      errors.boundaries = "boundaries must be an array of strings or an object.";
    }
  }

  // 12. boundary_preferences
  if (body.boundary_preferences !== undefined) {
    if (body.boundary_preferences === null) {
      // Allowed null to clear
    } else if (typeof body.boundary_preferences !== "object" || Array.isArray(body.boundary_preferences)) {
      errors.boundary_preferences = "boundary_preferences must be a JSON object.";
    } else {
      const allowedBpKeys = new Set([
        "quiet_hours",
        "physical_pace",
        "dating_environment",
        "off_app_transition"
      ]);
      const unsupportedBpKeys = Object.keys(body.boundary_preferences).filter((k) => !allowedBpKeys.has(k));
      if (unsupportedBpKeys.length > 0) {
        errors.boundary_preferences = `Unsupported boundary_preferences key(s): ${unsupportedBpKeys.join(", ")}.`;
      } else {
        const bp = body.boundary_preferences;
        if (bp.quiet_hours !== undefined && bp.quiet_hours !== null) {
          if (typeof bp.quiet_hours !== "object" || Array.isArray(bp.quiet_hours)) {
            errors["boundary_preferences.quiet_hours"] = "quiet_hours must be an object.";
          } else {
            if (bp.quiet_hours.enabled !== undefined && typeof bp.quiet_hours.enabled !== "boolean") {
              errors["boundary_preferences.quiet_hours.enabled"] = "quiet_hours.enabled must be a boolean.";
            }
            if (bp.quiet_hours.start_time !== undefined && !isValidTime(bp.quiet_hours.start_time)) {
              errors["boundary_preferences.quiet_hours.start_time"] = "start_time must be HH:MM in 24h format.";
            }
            if (bp.quiet_hours.end_time !== undefined && !isValidTime(bp.quiet_hours.end_time)) {
              errors["boundary_preferences.quiet_hours.end_time"] = "end_time must be HH:MM in 24h format.";
            }
          }
        }

        if (bp.physical_pace !== undefined && bp.physical_pace !== null) {
          if (typeof bp.physical_pace !== "string") {
            errors["boundary_preferences.physical_pace"] = "physical_pace must be a string.";
          }
        }

        if (bp.dating_environment !== undefined && bp.dating_environment !== null) {
          if (!Array.isArray(bp.dating_environment)) {
            errors["boundary_preferences.dating_environment"] = "dating_environment must be an array of strings.";
          } else {
            for (const item of bp.dating_environment) {
              if (typeof item !== "string" || item.trim().length === 0) {
                errors["boundary_preferences.dating_environment"] = "Each dating_environment item must be a non-empty string.";
                break;
              }
            }
          }
        }

        if (bp.off_app_transition !== undefined && bp.off_app_transition !== null) {
          if (typeof bp.off_app_transition !== "string") {
            errors["boundary_preferences.off_app_transition"] = "off_app_transition must be a string.";
          }
        }
      }
    }
  }

  // 13. location
  if (body.location !== undefined) {
    if (body.location === null) {
      // Allowed null to clear
    } else if (typeof body.location !== "object" || Array.isArray(body.location)) {
      errors.location = "location must be a JSON object.";
    } else {
      const allowedLocKeys = new Set(["city", "state", "country", "latitude", "longitude", "coordinates", "source"]);
      const unsupportedLocKeys = Object.keys(body.location).filter((k) => !allowedLocKeys.has(k));
      if (unsupportedLocKeys.length > 0) {
        errors.location = `Unsupported location key(s): ${unsupportedLocKeys.join(", ")}.`;
      } else {
        const loc = body.location;
        if (loc.city !== undefined && loc.city !== null && (typeof loc.city !== "string" || loc.city.trim().length === 0)) {
          errors["location.city"] = "city must be a non-empty string.";
        }
        if (loc.state !== undefined && loc.state !== null && (typeof loc.state !== "string" || loc.state.trim().length === 0)) {
          errors["location.state"] = "state must be a non-empty string.";
        }
        if (loc.country !== undefined && loc.country !== null && (typeof loc.country !== "string" || loc.country.trim().length === 0)) {
          errors["location.country"] = "country must be a non-empty string.";
        }
        if (loc.coordinates !== undefined && loc.coordinates !== null) {
          if (
            !Array.isArray(loc.coordinates) ||
            loc.coordinates.length !== 2 ||
            typeof loc.coordinates[0] !== "number" ||
            typeof loc.coordinates[1] !== "number" ||
            loc.coordinates[0] < -180 ||
            loc.coordinates[0] > 180 ||
            loc.coordinates[1] < -90 ||
            loc.coordinates[1] > 90
          ) {
            errors["location.coordinates"] = "coordinates must be an array of [longitude, latitude] numbers.";
          }
        }
        if (loc.latitude !== undefined && loc.latitude !== null) {
          if (typeof loc.latitude !== "number" || loc.latitude < -90 || loc.latitude > 90) {
            errors["location.latitude"] = "latitude must be a number between -90 and 90.";
          }
        }
        if (loc.longitude !== undefined && loc.longitude !== null) {
          if (typeof loc.longitude !== "number" || loc.longitude < -180 || loc.longitude > 180) {
            errors["location.longitude"] = "longitude must be a number between -180 and 180.";
          }
        }
        if (loc.source !== undefined && loc.source !== null) {
          if (typeof loc.source !== "string" || !ALLOWED_LOCATION_SOURCES.includes(loc.source.toLowerCase())) {
            errors["location.source"] = `source must be one of: ${ALLOWED_LOCATION_SOURCES.join(", ")}.`;
          }
        }
      }
    }
  }

  // 14. verification_selfie_upload_id
  if (body.verification_selfie_upload_id !== undefined) {
    if (
      typeof body.verification_selfie_upload_id !== "string" ||
      body.verification_selfie_upload_id.trim().length === 0
    ) {
      errors.verification_selfie_upload_id =
        "verification_selfie_upload_id must be a non-empty string.";
    }
  }

  // 15. biometric_consent
  if (body.biometric_consent !== undefined) {
    if (typeof body.biometric_consent !== "boolean") {
      errors.biometric_consent = "biometric_consent must be a boolean.";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

module.exports = {
  ALLOWED_GENDERS,
  ALLOWED_INTERESTED_IN,
  ALLOWED_DATING_INTENTIONS,
  ALLOWED_DATING_SPEEDS,
  ALLOWED_PHYSICAL_PACE,
  ALLOWED_OFF_APP_TRANSITIONS,
  ALLOWED_LOCATION_SOURCES,
  KNOWN_INTERESTS,
  isValidDate,
  calculateAge,
  isValidTime,
  validateProfilePatch
};
