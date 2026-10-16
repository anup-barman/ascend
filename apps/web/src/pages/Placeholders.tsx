import { NotYetBuilt } from '../components/ui';

/**
 * Screens whose engines arrive in later milestones.
 *
 * Each one states plainly what it will contain and what it is waiting on, and
 * deliberately shows no numbers. A mock chart here would be indistinguishable
 * from a real reading later, which is exactly what §58 forbids.
 */

export function Train() {
  return (
    <NotYetBuilt
      milestone="Milestone 5"
      what="Today's training session: an explicit objective, timed items sized to the minutes you actually have, and a start/abandon timer on each problem that records reading, thinking, coding and debugging time — the signals no platform exposes."
      needs="the weakness engine and the problem recommender, which both need synchronized history."
    />
  );
}

export function Contests() {
  return (
    <NotYetBuilt
      milestone="Milestone 6"
      what="Contest simulations built from Codeforces Gym ICPC sets, run behind a full-screen contest mode with a timer, attempt tracking and penalty — then unlocked into a post-contest report comparing this run against your previous ones."
      needs="Gym synchronization, then the simulation engine."
    />
  );
}

export function Analytics() {
  return (
    <NotYetBuilt
      milestone="Milestone 4"
      what="Charts that each answer a training question: readiness trend, topic mastery matrix, difficulty progression, solve-time distribution, verdict mix and repeated-mistake frequency. No vanity graphs."
      needs="synchronized submissions and the readiness engine."
    />
  );
}

export function Syllabus() {
  return (
    <NotYetBuilt
      milestone="Milestone 4"
      what="Your dynamic syllabus: the ICPC topic taxonomy ranked by what is worth learning in the time remaining, with each topic's mastery state, last practice date and forgetting risk — and low-value topics suppressed as the Regional approaches."
      needs="the topic taxonomy and problem classification."
    />
  );
}

export function Mistakes() {
  return (
    <NotYetBuilt
      milestone="Milestone 8"
      what="The mistake journal: recurring errors with their cause, the lesson, and how many times you have repeated them — so the coach can tell you when you have made the same off-by-one four times in six weeks."
      needs="submission analysis and contest reports to draw mistakes from."
    />
  );
}

export function History() {
  return (
    <NotYetBuilt
      milestone="Milestone 3"
      what="Your full contest and submission history across Codeforces, Codeforces Gym and AtCoder, normalized into one timeline with verdicts, attempts per problem, runtime and language."
      needs="the synchronization engine."
    />
  );
}

export function Coach() {
  return (
    <NotYetBuilt
      milestone="Milestone 7"
      what="The coach: an evidence-driven conversation about your preparation, where every claim about your performance is drawn from your local data and every recommendation carries its reasoning. Not a general-purpose chatbot."
      needs="the readiness and weakness engines, plus an AI provider configured in Settings."
    />
  );
}
