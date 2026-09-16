const API = "https://api.github.com";

async function rest(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.errors?.map((e) => e.message || e.code).join("; ") || data?.message || res.statusText;
    const err = new Error(`GitHub ${method} ${path} failed (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function graphql(token, query, variables) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(`GitHub GraphQL: ${data.errors.map((e) => e.message).join("; ")}`);
  return data.data;
}

export async function testGithub(token) {
  const me = await rest(token, "GET", "/user");
  return `Authenticated as ${me.login}.`;
}

export async function createIssue(token, repo, { title, body, labels }) {
  const issue = await rest(token, "POST", `/repos/${repo}/issues`, { title, body, labels });
  return { number: issue.number, url: issue.html_url, nodeId: issue.node_id };
}

export async function updateIssueBody(token, repo, number, body) {
  await rest(token, "PATCH", `/repos/${repo}/issues/${number}`, { body });
}

async function ensureBranch(token, repo, branch) {
  try {
    await rest(token, "GET", `/repos/${repo}/git/ref/heads/${branch}`);
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const { default_branch } = await rest(token, "GET", `/repos/${repo}`);
  const base = await rest(token, "GET", `/repos/${repo}/git/ref/heads/${default_branch}`);
  await rest(token, "POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha });
}

// Commits a PNG to a side branch so the issue can embed it. Returns a URL that renders inline on GitHub.
export async function uploadScreenshot(token, repo, branch, filename, dataUrl) {
  await ensureBranch(token, repo, branch);
  const path = `screenshots/${filename}`;
  await rest(token, "PUT", `/repos/${repo}/contents/${path}`, {
    message: `Bug capture screenshot: ${filename}`,
    content: dataUrl.split(",")[1],
    branch,
  });
  return `https://github.com/${repo}/blob/${branch}/${path}?raw=true`;
}

const PROJECT_QUERY = (ownerType) => `
  query($owner: String!, $number: Int!) {
    ${ownerType}(login: $owner) {
      projectV2(number: $number) {
        id
        title
        fields(first: 50) {
          nodes {
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name } }
          }
        }
      }
    }
  }`;

async function getProject(token, owner, number) {
  const cacheKey = `project:${owner}:${number}`;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) return cached;
  let project = null;
  for (const ownerType of ["user", "organization"]) {
    try {
      project = (await graphql(token, PROJECT_QUERY(ownerType), { owner, number }))[ownerType]?.projectV2;
      if (project) break;
    } catch {}
  }
  if (!project) throw new Error(`Project #${number} not found for ${owner} (token needs the "project" scope).`);
  await chrome.storage.session.set({ [cacheKey]: project });
  return project;
}

function pickOption(field, wanted) {
  if (!field?.options?.length || !wanted) return null;
  const w = wanted.toLowerCase();
  return (
    field.options.find((o) => o.name.toLowerCase() === w) ||
    field.options.find((o) => o.name.toLowerCase().includes(w) || w.includes(o.name.toLowerCase())) ||
    null
  );
}

// Adds the issue to the project and fills Status (from settings) and Priority/Severity (from the draft) when
// single-select fields with those names exist. Returns a description of what was set.
export async function addToProject(token, repo, projectNumber, issueNodeId, { status, severity }) {
  const owner = repo.split("/")[0];
  const project = await getProject(token, owner, projectNumber);
  const { addProjectV2ItemById } = await graphql(
    token,
    `mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }`,
    { p: project.id, c: issueNodeId }
  );
  const itemId = addProjectV2ItemById.item.id;

  const fields = project.fields.nodes.filter((f) => f?.options);
  const byName = (names) => fields.find((f) => names.includes(f.name.toLowerCase()));
  const wanted = [
    [byName(["status"]), status],
    [byName(["priority", "severity"]), severity],
  ];
  const set = [];
  for (const [field, value] of wanted) {
    const option = pickOption(field, value);
    if (!option) continue;
    await graphql(
      token,
      `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
        updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } }
      }`,
      { p: project.id, i: itemId, f: field.id, o: option.id }
    );
    set.push(`${field.name}: ${option.name}`);
  }
  return { projectTitle: project.title, set };
}
