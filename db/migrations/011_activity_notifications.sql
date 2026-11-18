
CREATE OR REPLACE FUNCTION ss_activity_notification(
  recipient INTEGER, heading TEXT, destination TEXT, event TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notifications(user_id,title,route,event_key)
  VALUES(recipient,heading,destination,event)
  ON CONFLICT(user_id,event_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ss_booking_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  skill_title TEXT;
BEGIN
  SELECT title INTO skill_title FROM listings WHERE id=NEW.listing_id;

  PERFORM ss_activity_notification(
    NEW.mentor_id,
    'New session booking: ' || COALESCE(skill_title,'Skill session'),
    'dashboard/room/booking/' || NEW.id,
    'booking-created-teacher:' || NEW.id
  );

  PERFORM ss_activity_notification(
    NEW.learner_id,
    'Session reserved: ' || COALESCE(skill_title,'Skill session') ||
      CASE WHEN NEW.payment_required THEN '. Payment is required.' ELSE '.' END,
    CASE WHEN NEW.payment_required
      THEN 'checkout/' || NEW.id
      ELSE 'dashboard/room/booking/' || NEW.id END,
    'booking-created-learner:' || NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER ss_booking_created_notice
AFTER INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION ss_booking_notification();

CREATE OR REPLACE FUNCTION ss_exchange_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  heading TEXT;
  event TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM ss_activity_notification(
      NEW.recipient_id,
      'New exchange request: ' || NEW.requester_skill ||
        ' in exchange for ' || NEW.recipient_skill,
      'dashboard/exchanges',
      'exchange-request:' || NEW.id
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    heading := CASE NEW.status
      WHEN 'negotiating' THEN 'Exchange request accepted. Agree on the details and schedule.'
      WHEN 'rejected' THEN 'Exchange request declined.'
      WHEN 'cancelled' THEN 'Exchange request cancelled.'
      WHEN 'active' THEN 'Exchange agreement confirmed by both students.'
      WHEN 'completed' THEN 'Exchange completed. All sessions are confirmed.'
      ELSE 'Exchange status updated.'
    END;

    event := 'exchange-status:' || NEW.id || ':' ||
      NEW.revision || ':' || NEW.status;

    PERFORM ss_activity_notification(
      NEW.requester_id,heading,'dashboard/exchanges',event
    );
    PERFORM ss_activity_notification(
      NEW.recipient_id,heading,'dashboard/exchanges',event
    );
  END IF;

  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    event := 'exchange-agreement:' || NEW.id || ':' || NEW.revision;
    PERFORM ss_activity_notification(
      NEW.requester_id,'Exchange agreement updated. Review this revision.',
      'dashboard/exchanges',event
    );
    PERFORM ss_activity_notification(
      NEW.recipient_id,'Exchange agreement updated. Review this revision.',
      'dashboard/exchanges',event
    );
  ELSE
    IF NEW.requester_accepted AND NOT OLD.requester_accepted
       AND NEW.status <> 'active' THEN
      PERFORM ss_activity_notification(
        NEW.recipient_id,'Your exchange partner accepted the agreement.',
        'dashboard/exchanges',
        'exchange-accept-requester:' || NEW.id || ':' || NEW.revision
      );
    END IF;

    IF NEW.recipient_accepted AND NOT OLD.recipient_accepted
       AND NEW.status <> 'active' THEN
      PERFORM ss_activity_notification(
        NEW.requester_id,'Your exchange partner accepted the agreement.',
        'dashboard/exchanges',
        'exchange-accept-recipient:' || NEW.id || ':' || NEW.revision
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ss_exchange_activity_notice
AFTER INSERT OR UPDATE ON exchanges
FOR EACH ROW EXECUTE FUNCTION ss_exchange_notification();

CREATE OR REPLACE FUNCTION ss_room_message_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  first_user INTEGER;
  second_user INTEGER;
  recipient INTEGER;
  destination TEXT;
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    SELECT learner_id,mentor_id INTO first_user,second_user
    FROM bookings WHERE id=NEW.booking_id;
    destination := 'dashboard/room/booking/' || NEW.booking_id;
  ELSE
    SELECT requester_id,recipient_id INTO first_user,second_user
    FROM exchanges WHERE id=NEW.exchange_id;
    destination := 'dashboard/room/exchange/' || NEW.exchange_id;
  END IF;

  recipient := CASE
    WHEN NEW.sender_id=first_user THEN second_user
    WHEN NEW.sender_id=second_user THEN first_user
    ELSE NULL END;

  IF recipient IS NOT NULL THEN
    PERFORM ss_activity_notification(
      recipient,'New message in your learning room.',
      destination,'learning-message:' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ss_learning_message_notice
AFTER INSERT ON learning_messages
FOR EACH ROW EXECUTE FUNCTION ss_room_message_notification();

CREATE OR REPLACE FUNCTION ss_exchange_session_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  learner INTEGER;
BEGIN
  SELECT CASE WHEN requester_id=NEW.teacher_id
    THEN recipient_id ELSE requester_id END
  INTO learner FROM exchanges WHERE id=NEW.exchange_id;

  IF NEW.teacher_completed AND NOT OLD.teacher_completed THEN
    PERFORM ss_activity_notification(
      learner,'Your exchange teacher marked the session complete. Please confirm.',
      'dashboard/room/exchange/' || NEW.exchange_id,
      'exchange-session-delivered:' || NEW.id
    );
  END IF;

  IF NEW.learner_confirmed AND NOT OLD.learner_confirmed THEN
    PERFORM ss_activity_notification(
      NEW.teacher_id,'Your exchange learner confirmed session completion.',
      'dashboard/room/exchange/' || NEW.exchange_id,
      'exchange-session-confirmed:' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ss_exchange_session_notice
AFTER UPDATE ON exchange_sessions
FOR EACH ROW EXECUTE FUNCTION ss_exchange_session_notification();
