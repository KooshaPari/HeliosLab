# User Journeys — heliosApp

## Overview

This document captures the primary user journeys for the heliosApp platform. heliosApp is a TypeScript monorepo (Bun runtime) with a SolidJS web frontend, React Native mobile client, and REST/gRPC backend APIs. It serves as the main application platform for personal and professional productivity, job search, collaboration, and task management.

**ID format:** UJ-{N}
**Cross-references:** PRD.md epics, FUNCTIONAL_REQUIREMENTS.md FR-* IDs

---

## UJ-1: New User Onboarding and Profile Setup

**Actor:** First-time user (web or mobile)
**Goal:** Complete account creation, personalize profile, and reach the main dashboard in a working state.
**Preconditions:**
- User has a valid email address
- heliosApp web or mobile client is reachable
- Auth service and profile service are running

```
  [User opens heliosApp]
          |
          v
  [Landing / Marketing page]
          |
          | click "Get Started"
          v
  [Registration form]
  - Email, password, name
          |
          | submit
          v
  [Email verification sent]
          |
          | user clicks link in email
          v
  [Email verified -> Auth token issued]
          |
          v
  [Onboarding wizard — Step 1: Basic Profile]
  - Display name, avatar upload, timezone
          |
          v
  [Step 2: Role / Use-case selection]
  - "Job seeker", "Team lead", "Independent", "Student"
          |
          v
  [Step 3: Connect integrations (optional)]
  - GitHub, LinkedIn, Google Calendar
  - Can skip
          |
          v
  [Step 4: Create first workspace or join existing]
          |
          v
  [Onboarding complete -> redirect to Dashboard]
          |
          v
  [Dashboard rendered with welcome tour overlay]
          |
          | dismiss tour
          v
  [User lands on active Dashboard]
```

**Postconditions / Success Criteria:**
- User account exists in auth service with verified email
- Profile record created with at minimum display name and timezone
- User is on the dashboard with a valid session token
- Welcome tour has been triggered (dismissed or completed)

**Error paths:**
- Email already registered -> show "Sign in instead" prompt
- Email verification link expired -> resend flow
- Integration OAuth failure -> skip silently, surface retry in Settings
- Network error during wizard -> persist wizard state locally, resume on reload

---

## UJ-2: Job Search and Application Tracking

**Actor:** Authenticated user with "Job seeker" role or any user who activates job tracking
**Goal:** Search for job opportunities, save listings, and track application status through the full pipeline.
**Preconditions:**
- User is authenticated and on the dashboard
- Job search service (REST API) is reachable
- Optional: LinkedIn or job board integration connected (UJ-1 Step 3)

```
  [Dashboard]
          |
          | navigate to "Jobs" section
          v
  [Job Search page]
          |
  +-------+--------+
  |                |
  | Enter keywords | Use saved search
  | + filters      | or integration feed
  | (title, loc,   |
  |  salary, type) |
  +-------+--------+
          |
          v
  [Search results list]
  - Job cards: title, company, location, posted date, match score
          |
          | click job card
          v
  [Job detail view]
  - Full description, requirements, salary range
  - Company profile panel
          |
  +-------+----------+
  |                  |
  | "Save listing"   | "Start application"
  v                  v
  [Saved to          [Application record created]
   Saved Jobs list]  [Status: "Interested"]
                          |
                          v
                  [Application detail view]
                  - Status pipeline:
                    Interested -> Applied -> Phone Screen
                    -> Interview -> Offer -> Accepted/Rejected
                          |
                          | update status
                          v
                  [Status updated, timeline entry added]
                          |
                          v
                  [Optional: attach resume, notes, contacts]
                          |
                          v
                  [Application visible in pipeline board]
```

**Postconditions / Success Criteria:**
- Job listing is saved or application record exists in the database
- Application has at minimum one status entry in the timeline
- Application appears in the Kanban pipeline board under correct column
- Notifications configured for status reminders (if enabled)

**Error paths:**
- Search service unavailable -> show cached results with stale timestamp, retry button
- Job listing expired (404 from source) -> mark as "Listing closed", retain local record
- Resume attachment upload fails -> retry with progress indicator, fallback to link entry
- Duplicate application detected -> prompt to view existing record instead

---

## UJ-3: Task and Project Management Workflow

**Actor:** Authenticated user (individual or team member)
**Goal:** Create a project, break it into tasks, assign ownership, and track completion.
**Preconditions:**
- User is authenticated
- User has a workspace (created during onboarding or joined)
- Task service and project service APIs are available

```
  [Dashboard or Projects section]
          |
          | click "New Project"
          v
  [Project creation modal]
  - Name, description, due date, visibility (personal / workspace)
          |
          | confirm
          v
  [Project created -> Project board opens]
          |
          v
  [Task creation]
  - Click "+ Add Task" in any column
  - Enter title, description, priority, due date
  - Assign to self or team member
          |
          v
  [Task appears in "To Do" column]
          |
          | drag task or change status
          v
  [Task moves through pipeline]
  To Do -> In Progress -> In Review -> Done
          |
          v
  [Subtask support]
  - Open task -> "Add Subtask"
  - Subtasks nest under parent, tracked independently
          |
          v
  [Task detail view]
  - Comments thread
  - File attachments
  - Activity log (who changed what, when)
  - Due date reminder toggle
          |
          | all tasks reach "Done"
          v
  [Project completion prompt]
  - Archive or close project
  - Export summary report (PDF/CSV)
```

**Postconditions / Success Criteria:**
- Project and all tasks are persisted in the task service
- Task status transitions are logged in the activity feed
- Assigned team members received notifications (if notification preferences allow)
- Completed project is archivable and summary is exportable

**Error paths:**
- Task save fails (network) -> optimistic UI reverts, error toast, retry available
- Assigned user not in workspace -> prompt to invite or reassign
- Circular subtask dependency detected -> reject with explanatory error
- Due date set in the past -> warn, do not block creation

---

## UJ-4: Collaboration and Team Features

**Actor:** Workspace admin or team lead inviting collaborators; team members joining and contributing
**Goal:** Invite team members to a workspace, assign roles, collaborate on shared projects and tasks, and communicate via in-app messaging.
**Preconditions:**
- Workspace exists (created or joined during onboarding)
- Inviting user has admin or owner role in the workspace
- Email service is reachable for invite delivery

```
  [Workspace Settings -> Members]
          |
          | click "Invite Member"
          v
  [Invite modal]
  - Enter email address(es)
  - Select role: Viewer / Member / Admin
          |
          | send invite
          v
  [Invite email delivered to recipient]
          |
          | recipient clicks invite link
          v
  [Recipient: new user?]
  +-----YES------+------NO------+
  |                             |
  v                             v
  [Registration flow        [Login flow]
   (abbreviated UJ-1)]           |
  |                             |
  +-------------+---------------+
                |
                v
  [Recipient lands in workspace]
  [Role applied, workspace visible in sidebar]
                |
                v
  [Collaboration features available]
  - Shared projects and task boards
  - Inline task comments (@mention triggers notification)
  - Real-time presence indicators (online/editing)
  - Direct messages between workspace members
  - Shared file attachments on tasks and projects
                |
                | team lead reassigns task
                v
  [Task assignee updated]
  [Previous and new assignee notified]
                |
                v
  [Activity feed shows all workspace changes]
  - Filterable by project, member, date range
```

**Postconditions / Success Criteria:**
- Invited member appears in workspace member list with correct role
- Invited member can view and interact with shared projects per role permissions
- @mentions generate in-app and email notifications
- Activity feed reflects all collaborative actions with actor and timestamp

**Error paths:**
- Invite email bounces -> surface delivery failure in Members panel, allow resend
- Invite link expired (>7 days) -> redirect to "Request new invite" page
- Role escalation attempted by non-admin -> reject with permission error
- Real-time sync conflict (two users edit same task simultaneously) -> last-write-wins with conflict toast and undo option

---

## UJ-5: Settings and Integrations Configuration

**Actor:** Authenticated user configuring personal preferences and third-party integrations
**Goal:** Customize notification preferences, appearance, connected accounts, and API integrations; verify all integrations are healthy.
**Preconditions:**
- User is authenticated
- Settings service is reachable
- OAuth providers (GitHub, Google, LinkedIn) have heliosApp registered as a client

```
  [Any page -> User avatar / menu -> "Settings"]
          |
          v
  [Settings dashboard]
  Sections:
  - Profile
  - Account & Security
  - Notifications
  - Appearance
  - Integrations
  - API Keys
  - Danger Zone
          |
  +-------+--------+--------+--------+
  |       |        |        |        |
  v       v        v        v        v

[Profile]        [Notifications]    [Integrations]
- Name, avatar   - Email digest      - Connect GitHub
- Bio, timezone  - Push (mobile)     - Connect Google Calendar
- Display prefs  - In-app alerts     - Connect LinkedIn
- Pronouns       - Per-project       - Connect Slack
                   overrides         - View connection status
                                     - Revoke access
          |               |                  |
          v               v                  v
  [Save -> API PATCH  [Toggle saved     [OAuth redirect
   /users/me]          immediately]      -> callback
                                         -> token stored]
                                              |
                                              v
                                     [Integration health check]
                                     - Green: active, last sync time
                                     - Yellow: degraded, last error
                                     - Red: disconnected, reconnect CTA

[API Keys]
- List existing keys (name, created, last used, scopes)
- "Generate new key" -> name + scope selection
- Copy key (shown once)
- Revoke key

[Danger Zone]
- Delete account (requires email confirmation)
- Export all data (GDPR/CCPA download)
```

**Postconditions / Success Criteria:**
- All preference changes are persisted and take effect immediately or on next page load
- Connected integrations show green health status and correct last-sync timestamp
- API keys are stored hashed; plaintext shown only once at creation
- Data export is queued and delivered via email within a defined SLA

**Error paths:**
- OAuth provider returns error -> surface specific error code, link to provider status page
- Integration sync failure (rate limited by provider) -> surface in health indicator, auto-retry with backoff
- API key generation fails -> retry; if persistent, surface support link
- Account deletion email not received -> resend flow with 60-second cooldown
- Profile save fails validation (e.g., avatar too large) -> inline field error, no data lost

---

## Journey Index

| ID   | Title                                | Actor                | Primary API Surface         |
|------|--------------------------------------|----------------------|-----------------------------|
| UJ-1 | New User Onboarding and Profile Setup | First-time user      | Auth, Profile               |
| UJ-2 | Job Search and Application Tracking  | Job seeker           | Jobs, Applications, Search  |
| UJ-3 | Task and Project Management Workflow | Any authenticated user | Tasks, Projects            |
| UJ-4 | Collaboration and Team Features      | Admin + team members | Workspace, Members, Notify  |
| UJ-5 | Settings and Integrations Config     | Any authenticated user | Settings, OAuth, API Keys  |

---

*Cross-references: PRD.md, FUNCTIONAL_REQUIREMENTS.md, ADR.md*
*Last updated: 2026-03-26*
