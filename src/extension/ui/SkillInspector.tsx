import type { WebSkill } from "../../shared/types";

export interface SkillInspectorProps {
  skills: WebSkill[];
}

export function SkillInspector({ skills }: SkillInspectorProps) {
  return (
    <section className="inspector-section" aria-labelledby="learned-skills-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Priority 02</p>
          <h3 id="learned-skills-heading">Learned Skills</h3>
        </div>
        <span className="count-pill memory-count">{skills.length}</span>
      </div>
      {skills.length === 0 ? (
        <div className="empty-state">The first successful task becomes durable memory</div>
      ) : (
        <div className="tool-list">
          {skills.map((skill) => (
            <article className="tool-row" key={skill.id}>
              <span className="source-dot source-dot-memory" />
              <div className="skill-copy">
                <code>{skill.name}()</code>
                <p>
                  {skill.workflow.length} actions · {Math.round(skill.successRate * 100)}% success
                </p>
              </div>
              <span className="version-tag">v{skill.version}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
