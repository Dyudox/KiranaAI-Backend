import express from "express";
import {
  getSuggestedQuestions,
  createSuggestedQuestion,
  toggleQuestionStatus,
  deleteSuggestedQuestion,
  updateSuggestedQuestion,
} from "../controllers/suggestedQuestionController.js";

const router = express.Router();

router.get("/suggested-questions", getSuggestedQuestions);
router.post("/suggested-questions", createSuggestedQuestion);
router.patch("/suggested-questions/:id/status", toggleQuestionStatus);
router.delete("/suggested-questions/:id", deleteSuggestedQuestion);
router.put("/suggested-questions/:id", updateSuggestedQuestion);

export default router;
